'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type CallState = 'idle' | 'calling' | 'active' | 'ended' | 'incoming';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Configuración de voz y saludos
const VOICE_ID = 'ERYLdjEaddaiN9sDjaMX';
const AGENT_NAME = 'Cristina';
const GREETING = '¡Rubén! ¿Rubén? Sí, mira, soy Cristina, de Syntalys Tech. Estoy entre reuniones ahora mismo y tengo literalmente treinta segunditos, o sea que yo tampoco tengo mucho tiempo para explicarte todo. Nada, te llamo por algo muy rápido. Estamos revisando facturas de luz de empresas como la tuya, y ya hemos ayudado a gente como Mario o Dani a ahorrarse unos cincuenta euros al mes, sin que ellos tuvieran que hacer prácticamente nada. ¿Sería una locura ver si podemos hacer algo parecido contigo... o lo descartamos y ya está?';

// Mensaje de seguimiento con el ahorro - YA sabe que es titular y tiene la factura
const FOLLOWUP_GREETING = '¡Rubéeen! ¡Soy Cristina! Oye, qué bien que te pillo. Mira, acabo de salir de la reunión y tengo una noticia que te va a encantar. He revisado tu factura y... treinta y siete euritos al mes. O sea, cuatrocientos y pico al año que te estás dejando ahí tirados. El cambio es facilísimo, nosotros nos encargamos de todo, tú no tienes que hacer nada de nada. ¿Qué me dices, lo cerramos ya?';

// Frases EXACTAS que indican que Cristina se despide DESPUÉS de que el usuario confirmó
// Solo triggers muy específicos de despedida final - deben ser frases completas de cierre
const HANGUP_TRIGGERS_FIRST_CALL = [
  'te llamo en un ratito con los números, ¡hablamos pronto',
  'gracias por tu tiempo, de verdad'
];

// Frases que indican fin de la segunda llamada (cierre definitivo)
const HANGUP_TRIGGERS_FINAL = [
  'en tu próxima factura ya lo notas',
  'en tu próxima factura lo notarás',
  'pues queda cerrado',
  'ya está todo listo',
  'gracias por confiar en nosotros'
];

export default function Home() {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [currentTime, setCurrentTime] = useState('9:41');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isFollowupCall, setIsFollowupCall] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ringStopRef = useRef<(() => void) | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isFollowupCallRef = useRef(false);
  const previousMessagesRef = useRef<Message[]>([]); // Guardar historial de la primera llamada

  // Mantener ref actualizada
  useEffect(() => {
    isFollowupCallRef.current = isFollowupCall;
  }, [isFollowupCall]);

  const dialPad = [
    { num: '1', letters: '' },
    { num: '2', letters: 'ABC' },
    { num: '3', letters: 'DEF' },
    { num: '4', letters: 'GHI' },
    { num: '5', letters: 'JKL' },
    { num: '6', letters: 'MNO' },
    { num: '7', letters: 'PQRS' },
    { num: '8', letters: 'TUV' },
    { num: '9', letters: 'WXYZ' },
    { num: '*', letters: '' },
    { num: '0', letters: '+' },
    { num: '#', letters: '' },
  ];

  useEffect(() => {
    const update = () => {
      setCurrentTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (callState === 'idle') setCallDuration(0);
      // Parar el audio INMEDIATAMENTE cuando la llamada termina o está idle
      if (callState === 'ended' || callState === 'idle') {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.src = '';
          audioRef.current.load();
        }
        setIsAISpeaking(false);
      }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const playTone = (freq: number, duration: number) => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.1;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch {}
  };

  const playRing = () => {
    try {
      const ctx = new AudioContext();
      const ring = () => {
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o1.connect(g); o2.connect(g); g.connect(ctx.destination);
        o1.frequency.value = 440; o2.frequency.value = 480;
        g.gain.value = 0.08;
        o1.start(); o2.start();
        setTimeout(() => { o1.stop(); o2.stop(); }, 400);
      };
      ring();
      const interval = setInterval(ring, 2000);
      return () => { clearInterval(interval); ctx.close(); };
    } catch { return () => {}; }
  };

  // Parar escucha completamente
  const stopListening = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current?.state !== 'closed') {
      try { audioContextRef.current?.close(); } catch {}
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    isRecordingRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  // Hablar texto con la voz de ElevenLabs
  const speakText = useCallback(async (text: string): Promise<void> => {
    return new Promise(async (resolve) => {
      stopListening(); // Parar escucha antes de hablar
      setIsAISpeaking(true);

      try {
        const res = await fetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId: VOICE_ID }),
        });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.onended = () => {
            setIsAISpeaking(false);
            URL.revokeObjectURL(url);
            resolve();
          };
          audioRef.current.onerror = () => {
            setIsAISpeaking(false);
            URL.revokeObjectURL(url);
            resolve();
          };
          await audioRef.current.play();
        } else {
          setIsAISpeaking(false);
          resolve();
        }
      } catch {
        setIsAISpeaking(false);
        resolve();
      }
    });
  }, [stopListening]);

  // Procesar transcripción y obtener respuesta IA
  const processTranscription = useCallback(async (blob: Blob) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    stopListening(); // Parar todo antes de procesar

    try {
      const form = new FormData();
      form.append('audio', blob);
      form.append('language', 'es');

      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (data.text?.trim() && data.text.trim().length > 1) {
        // Añadir mensaje del usuario
        const userMsg = data.text.trim();
        setMessages(m => [...m, { role: 'user', content: userMsg }]);

        // Obtener respuesta de la IA
        const chatRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, { role: 'user', content: userMsg }]
          }),
        });

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const aiMessage = chatData.message;
          setMessages(m => [...m, { role: 'assistant', content: aiMessage }]);
          await speakText(aiMessage);

          // Detectar si Cristina dice que va a colgar
          const messageLower = aiMessage.toLowerCase();

          // En la primera llamada, detectar si va a revisar la factura
          const shouldHangupFirstCall = !isFollowupCallRef.current &&
            HANGUP_TRIGGERS_FIRST_CALL.some(trigger => messageLower.includes(trigger));

          // En la segunda llamada, detectar despedida final
          const shouldHangupFinal = isFollowupCallRef.current &&
            HANGUP_TRIGGERS_FINAL.some(trigger => messageLower.includes(trigger));

          if (shouldHangupFirstCall) {
            // Primera llamada: guardar historial y colgar
            previousMessagesRef.current = [...messages, { role: 'user', content: userMsg }, { role: 'assistant', content: aiMessage }];
            setTimeout(() => {
              stopListening();
              setIsAISpeaking(false);
              isProcessingRef.current = false;
              setCallState('ended');

              // A los 3 segundos, simular llamada entrante
              setTimeout(() => {
                setIsFollowupCall(true);
                setCallState('incoming');
                ringStopRef.current = playRing();
              }, 3000);
            }, 1500);
          } else if (shouldHangupFinal) {
            // Segunda llamada: colgar definitivamente
            setTimeout(() => {
              stopListening();
              setIsAISpeaking(false);
              isProcessingRef.current = false;
              setCallState('ended');
              // No hay llamada de seguimiento, termina aquí
              setTimeout(() => {
                setCallState('idle');
                setMessages([]);
                setIsFollowupCall(false);
                previousMessagesRef.current = []; // Limpiar historial
              }, 3000);
            }, 1500);
          }
        }
      }
    } catch (err) {
      console.error('Error processing:', err);
    } finally {
      isProcessingRef.current = false;
    }
  }, [messages, speakText, stopListening, playRing]);

  // Iniciar escucha con VAD
  const startListening = useCallback(async () => {
    if (isProcessingRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      analyser.fftSize = 512;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (audioChunksRef.current.length === 0) return;
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        if (blob.size < 1000) return;
        await processTranscription(blob);
      };

      setIsListening(true);
      let animationId: number;

      const checkAudio = () => {
        if (!analyserRef.current || !streamRef.current?.active || isProcessingRef.current) {
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const THRESHOLD = 25;

        if (average > THRESHOLD) {
          setIsSpeaking(true);

          if (!isRecordingRef.current && recorder.state === 'inactive') {
            audioChunksRef.current = [];
            recorder.start(100);
            isRecordingRef.current = true;
          }

          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
        } else {
          if (isRecordingRef.current && !silenceTimeoutRef.current) {
            silenceTimeoutRef.current = setTimeout(() => {
              setIsSpeaking(false);
              if (recorder.state === 'recording') {
                recorder.stop();
                isRecordingRef.current = false;
              }
              silenceTimeoutRef.current = null;
            }, 1200);
          }
        }

        animationId = requestAnimationFrame(checkAudio);
      };

      checkAudio();

      return () => {
        if (animationId) cancelAnimationFrame(animationId);
      };

    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  }, [processTranscription]);

  // Reiniciar escucha después de que la IA termine de hablar
  useEffect(() => {
    if (callState === 'active' && !isAISpeaking && !isListening && !isProcessingRef.current) {
      const timeout = setTimeout(() => {
        startListening();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [callState, isAISpeaking, isListening, startListening]);

  const startCall = async () => {
    setCallState('calling');
    ringStopRef.current = playRing();
    setTimeout(() => {
      ringStopRef.current?.();
      setCallState('active');
      setMessages([]);
      setMessages([{ role: 'assistant', content: GREETING }]);
      speakText(GREETING);
    }, 2000);
  };

  // Función para parar el audio completamente
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
      audioRef.current.load();
    }
    setIsAISpeaking(false);
  }, []);

  const endCall = () => {
    ringStopRef.current?.();
    stopListening();
    stopAudio(); // Parar audio inmediatamente
    setCallState('ended');
    setIsFollowupCall(false);
    isProcessingRef.current = false;
    previousMessagesRef.current = []; // Limpiar historial
    setTimeout(() => { setCallState('idle'); setMessages([]); }, 2000);
  };

  // Aceptar llamada entrante (followup)
  const acceptIncomingCall = () => {
    ringStopRef.current?.();
    // Resetear estados para que el micrófono funcione
    isProcessingRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
    setIsAISpeaking(false);
    setCallState('active');
    setCallDuration(0);
    // Mantener el historial de la primera llamada + añadir el greeting de followup
    const historialPrevio = previousMessagesRef.current;
    setMessages([...historialPrevio, { role: 'assistant', content: FOLLOWUP_GREETING }]);
    speakText(FOLLOWUP_GREETING);
  };

  // Rechazar llamada entrante
  const rejectIncomingCall = () => {
    ringStopRef.current?.();
    setCallState('idle');
    setIsFollowupCall(false);
    setMessages([]);
    previousMessagesRef.current = []; // Limpiar historial
  };

  return (
    <div className="app-container">
      {/* Status Bar */}
      <div className="ios-status-bar">
        <span className="ios-time">{currentTime}</span>
        <div className="ios-status-icons">
          <svg width="18" height="12" viewBox="0 0 18 12" fill="white">
            <path d="M1 4.5C3.5 2 6.5 0.5 9 0.5s5.5 1.5 8 4l-1.5 1.5C13.5 4 11.3 3 9 3S4.5 4 2.5 6L1 4.5z"/>
            <path d="M4 7.5C5.7 5.8 7.3 5 9 5s3.3 0.8 5 2.5L12.5 9C11.3 7.8 10.2 7 9 7s-2.3 0.8-3.5 2L4 7.5z"/>
            <path d="M7 10.5C7.6 9.9 8.3 9.5 9 9.5s1.4 0.4 2 1l-2 2-2-2z"/>
          </svg>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="white">
            <rect x="1" y="3" width="3" height="9" rx="0.5"/>
            <rect x="5" y="2" width="3" height="10" rx="0.5"/>
            <rect x="9" y="1" width="3" height="11" rx="0.5"/>
            <rect x="13" y="0" width="3" height="12" rx="0.5"/>
          </svg>
          <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
            <rect x="0.5" y="0.5" width="23" height="12" rx="3" stroke="white" strokeOpacity="0.35"/>
            <rect x="2" y="2" width="20" height="9" rx="2" fill="white"/>
            <path d="M25 4v5a2 2 0 002-2V6a2 2 0 00-2-2z" fill="white" fillOpacity="0.4"/>
          </svg>
        </div>
      </div>

      {/* Content */}
      <div className="call-screen">
        {/* IDLE - Dial Pad */}
        {callState === 'idle' && (
          <>
            <div className="contact-section">
              <div className="contact-name">Demo Ruben</div>
              <div className="contact-status">AI Call Center</div>
            </div>

            <button onClick={startCall} className="cta-btn" style={{ margin: '20px auto 24px' }}>
              Iniciar llamada
            </button>

            <div className="dial-pad">
              {dialPad.map(({ num, letters }) => (
                <button key={num} className="dial-key" onClick={() => playTone(440, 100)}>
                  <span className="dial-key-number">{num}</span>
                  {letters && <span className="dial-key-letters">{letters}</span>}
                </button>
              ))}
            </div>

            <div className="call-controls">
              <button className="control-btn call" onClick={startCall}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {/* CALLING */}
        {callState === 'calling' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="avatar-container">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
            <div className="contact-name">{AGENT_NAME}</div>
            <div className="contact-status connecting-dots">
              Llamando<span>.</span><span>.</span><span>.</span>
            </div>
            <div style={{ marginTop: 'auto', paddingBottom: 50 }}>
              <button className="control-btn end" onClick={endCall}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* INCOMING CALL */}
        {callState === 'incoming' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="avatar-container pulsing">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
            <div className="contact-name">{AGENT_NAME}</div>
            <div className="contact-status" style={{ color: '#30d158' }}>
              Llamada entrante...
            </div>
            <div style={{ marginTop: 'auto', paddingBottom: 50, display: 'flex', gap: 60 }}>
              <button className="control-btn end" onClick={rejectIncomingCall}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              </button>
              <button className="control-btn call" onClick={acceptIncomingCall}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE */}
        {callState === 'active' && (
          <>
            <div className="contact-section" style={{ paddingTop: 20, paddingBottom: 10 }}>
              <div className={`avatar-container ${isAISpeaking ? 'speaking' : isSpeaking ? 'user-speaking' : ''}`} style={{ width: 80, height: 80 }}>
                {isAISpeaking ? (
                  <div className="visualizer">
                    {[...Array(5)].map((_, i) => <div key={i} className="visualizer-bar" />)}
                  </div>
                ) : isSpeaking ? (
                  <div className="visualizer user">
                    {[...Array(5)].map((_, i) => <div key={i} className="visualizer-bar" />)}
                  </div>
                ) : (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                  </svg>
                )}
              </div>
              <div className="contact-name" style={{ fontSize: 24 }}>{AGENT_NAME}</div>
              <div className="contact-status active">{formatTime(callDuration)}</div>
            </div>

            <div className={`status-text ${isSpeaking ? 'listening' : isAISpeaking ? 'speaking' : ''}`}>
              {isAISpeaking
                ? `${AGENT_NAME} está hablando...`
                : isSpeaking
                  ? 'Te estoy escuchando...'
                  : isListening
                    ? 'Habla cuando quieras'
                    : 'Conectando micrófono...'}
            </div>

            <div className="call-controls">
              <button className="control-btn mute">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              </button>
              <div className={`mic-indicator ${isSpeaking ? 'active' : isListening ? 'listening' : ''}`}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </div>
              <button className="control-btn end" onClick={endCall}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ENDED */}
        {callState === 'ended' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,59,48,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#ff3b30">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.96.96 0 01-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </div>
            <div className="contact-name" style={{ fontSize: 24 }}>Llamada finalizada</div>
            <div className="contact-status">{formatTime(callDuration)}</div>
          </div>
        )}
      </div>

      <audio ref={audioRef} />
    </div>
  );
}
