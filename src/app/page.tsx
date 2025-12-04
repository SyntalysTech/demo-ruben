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
const GREETING = '¡Rubén! Sí, mira, soy Cristina, de Syntalys Tech. Estoy entre reuniones ahora mismo y tengo literalmente treinta segunditos, así que no tengo mucho tiempo. Nada, te llamo por algo muy rápido. Estamos revisando facturas de luz de empresas como la tuya, y ya hemos ayudado a gente como Mario o Dani a ahorrarse unos cincuenta euros al mes, sin que ellos tuvieran que hacer prácticamente nada. ¿Sería una locura ver si podemos hacer algo parecido contigo... o lo descartamos y ya está?';

// Mensaje de seguimiento con el ahorro - YA sabe que es titular y tiene la factura
const FOLLOWUP_GREETING = '¡Rubéeen! ¡Soy Cristina! Oye, qué bien que te pillo. Mira, acabo de salir de la reunión y tengo una noticia que te va a encantar. He revisado tu factura y... treinta y siete euritos al mes. O sea, cuatrocientos y pico al año que te estás dejando ahí tirados. El cambio es facilísimo, nosotros nos encargamos de absolutamente todo. ¿Qué me dices, lo cerramos ya?';

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

// Frases que indican fin de llamada SIN segunda llamada (cliente rechaza completamente)
const HANGUP_NO_FOLLOWUP = [
  'cuando lo queráis revisar estoy por aquí',
  'gracias, rubén. hasta luego',
  'gracias rubén. hasta luego',
  'no te molesto más',
  'entiendo perfectamente',
  'cuando cambies de opinión',
  'aquí estaré',
  'que vaya bien',
  'sin problema, rubén',
  'vale, pues nada'
];

// Frases que indican callback a una hora específica (cliente no tiene tiempo pero quedamos a otra hora)
const HANGUP_CALLBACK = [
  'te llamo a las'
];

// Frases que indican que Cristina va a enviar WhatsApp
const WHATSAPP_TRIGGERS = [
  'te mando un whatsapp',
  'te mando ahora mismo un whatsapp',
  'envíamelas todas por whatsapp',
  'te mando el whatsapp'
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
  const [isCallbackCall, setIsCallbackCall] = useState(false); // Llamada de callback (quedamos a una hora)
  const [showWhatsAppNotification, setShowWhatsAppNotification] = useState(false);
  const whatsappShownRef = useRef(false); // Para evitar mostrar WhatsApp 2 veces
  const callStateRef = useRef<CallState>('idle'); // Ref para verificar estado en callbacks
  const callbackTimeRef = useRef<string>(''); // Hora a la que quedamos para callback
  const callbackForTitularRef = useRef<boolean>(false); // Si el callback es para hablar con el titular

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
  const bargeInStreamRef = useRef<MediaStream | null>(null); // Stream para detectar barge-in
  const bargeInContextRef = useRef<AudioContext | null>(null);
  const bargeInAnalyserRef = useRef<AnalyserNode | null>(null);

  // Mantener refs actualizadas
  useEffect(() => {
    isFollowupCallRef.current = isFollowupCall;
  }, [isFollowupCall]);

  useEffect(() => {
    callStateRef.current = callState;
    // Reset whatsapp flag cuando la llamada termina
    if (callState === 'idle') {
      whatsappShownRef.current = false;
    }
  }, [callState]);

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

  // Función para interrumpir el audio de la IA (barge-in)
  const interruptAI = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsAISpeaking(false);
    }
    // Limpiar barge-in detection
    if (bargeInStreamRef.current) {
      bargeInStreamRef.current.getTracks().forEach(t => t.stop());
      bargeInStreamRef.current = null;
    }
    if (bargeInContextRef.current?.state !== 'closed') {
      try { bargeInContextRef.current?.close(); } catch {}
    }
    bargeInContextRef.current = null;
    bargeInAnalyserRef.current = null;
  }, []);

  // Hablar texto con la voz de ElevenLabs (con escucha continua para barge-in)
  const speakText = useCallback(async (text: string): Promise<void> => {
    return new Promise(async (resolve) => {
      // Verificar si la llamada sigue activa
      if (callStateRef.current !== 'active') {
        resolve();
        return;
      }

      stopListening();
      setIsAISpeaking(true);

      let wasInterrupted = false;
      let bargeInRecorder: MediaRecorder | null = null;
      let bargeInChunks: Blob[] = [];
      let checkInterval: NodeJS.Timeout | null = null;

      // Función para limpiar barge-in
      const cleanupBargeIn = () => {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        if (bargeInRecorder?.state === 'recording') {
          try { bargeInRecorder.stop(); } catch {}
        }
        bargeInRecorder = null;
        if (bargeInStreamRef.current) {
          bargeInStreamRef.current.getTracks().forEach(t => t.stop());
          bargeInStreamRef.current = null;
        }
      };

      // Desactivado: el barge-in causaba cortes porque el micrófono captaba el audio de la IA
      // y lo interpretaba como si el usuario estuviera hablando.
      // El usuario debe esperar a que la IA termine de hablar.
      const setupContinuousListening = async () => {
        // No hacer nada - barge-in desactivado
      };

      try {
        const res = await fetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId: VOICE_ID }),
        });
        if (!res.ok) throw new Error();

        if (callStateRef.current !== 'active') {
          setIsAISpeaking(false);
          resolve();
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.src = url;

          // Iniciar escucha continua
          setupContinuousListening();

          audioRef.current.onended = () => {
            if (!wasInterrupted) {
              setIsAISpeaking(false);
              cleanupBargeIn();
            }
            URL.revokeObjectURL(url);
            resolve();
          };
          audioRef.current.onerror = () => {
            setIsAISpeaking(false);
            cleanupBargeIn();
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
        cleanupBargeIn();
        resolve();
      }
    });
  }, [stopListening, interruptAI]);

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

          // Detectar si Cristina menciona WhatsApp para mostrar notificación (solo una vez por llamada)
          const shouldShowWhatsApp = !whatsappShownRef.current &&
            WHATSAPP_TRIGGERS.some(trigger => messageLower.includes(trigger));
          if (shouldShowWhatsApp) {
            whatsappShownRef.current = true; // Marcar como mostrado
            setShowWhatsAppNotification(true);
            // Ocultar después de 5 segundos
            setTimeout(() => setShowWhatsAppNotification(false), 5000);
          }

          // Detectar si hay que colgar SIN segunda llamada (no tiene tiempo, rechaza, etc.)
          const shouldHangupNoFollowup = HANGUP_NO_FOLLOWUP.some(trigger => messageLower.includes(trigger));

          // Detectar si hay callback a una hora específica ("te llamo a las X")
          const shouldHangupCallback = HANGUP_CALLBACK.some(trigger => messageLower.includes(trigger));
          // Extraer la hora del mensaje si es callback
          if (shouldHangupCallback) {
            const horaMatch = aiMessage.match(/te llamo a las?\s*(\d{1,2}(?::\d{2})?(?:\s*(?:de la mañana|de la tarde|de la noche|h)?)?)/i);
            if (horaMatch) {
              callbackTimeRef.current = horaMatch[1];
            }
            // Detectar si el callback es para hablar con el titular (revisar TODO el historial de la conversación)
            const allMessages = [...messages, { role: 'user', content: userMsg }, { role: 'assistant', content: aiMessage }];
            callbackForTitularRef.current = allMessages.some(m =>
              m.content.toLowerCase().includes('tu padre') ||
              m.content.toLowerCase().includes('tu madre') ||
              m.content.toLowerCase().includes('el titular') ||
              m.content.toLowerCase().includes('cuando esté él') ||
              m.content.toLowerCase().includes('no soy titular')
            );
          }

          // En la primera llamada, detectar si va a revisar la factura
          const shouldHangupFirstCall = !isFollowupCallRef.current &&
            !shouldHangupNoFollowup &&
            !shouldHangupCallback &&
            HANGUP_TRIGGERS_FIRST_CALL.some(trigger => messageLower.includes(trigger));

          // En la segunda llamada, detectar despedida final
          const shouldHangupFinal = isFollowupCallRef.current &&
            HANGUP_TRIGGERS_FINAL.some(trigger => messageLower.includes(trigger));

          if (shouldHangupCallback) {
            // Guardar historial para la llamada de callback
            previousMessagesRef.current = [...messages, { role: 'user', content: userMsg }, { role: 'assistant', content: aiMessage }];
            // Colgar y hacer callback a la hora acordada
            isProcessingRef.current = true;
            callStateRef.current = 'ended';
            setTimeout(() => {
              stopListening();
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = '';
                audioRef.current.load();
              }
              setIsAISpeaking(false);
              setCallState('ended');
              // A los 3 segundos, simular llamada de callback
              setTimeout(() => {
                isProcessingRef.current = false;
                setIsCallbackCall(true);
                setIsFollowupCall(false);
                callStateRef.current = 'incoming';
                setCallState('incoming');
                ringStopRef.current = playRing();
              }, 3000);
            }, 500);
            return;
          } else if (shouldHangupNoFollowup) {
            // Colgar SIN segunda llamada (cliente rechaza completamente)
            isProcessingRef.current = true;
            callStateRef.current = 'ended';
            setTimeout(() => {
              stopListening();
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = '';
                audioRef.current.load();
              }
              setIsAISpeaking(false);
              setCallState('ended');
              // Volver a idle sin segunda llamada
              setTimeout(() => {
                callStateRef.current = 'idle';
                setCallState('idle');
                setMessages([]);
                setIsFollowupCall(false);
                setIsCallbackCall(false);
                previousMessagesRef.current = [];
                callbackTimeRef.current = '';
                callbackForTitularRef.current = false;
                isProcessingRef.current = false;
              }, 3000);
            }, 500);
            return;
          } else if (shouldHangupFirstCall) {
            // Primera llamada: guardar historial y colgar
            previousMessagesRef.current = [...messages, { role: 'user', content: userMsg }, { role: 'assistant', content: aiMessage }];
            // Marcar como procesando para evitar que el micro se reactive
            isProcessingRef.current = true;
            // Cambiar el estado inmediatamente en el ref para que speakText lo detecte
            callStateRef.current = 'ended';
            setTimeout(() => {
              stopListening();
              // Parar audio completamente
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = '';
                audioRef.current.load();
              }
              setIsAISpeaking(false);
              setCallState('ended');

              // A los 3 segundos, simular llamada entrante
              setTimeout(() => {
                isProcessingRef.current = false;
                setIsFollowupCall(true);
                callStateRef.current = 'incoming';
                setCallState('incoming');
                ringStopRef.current = playRing();
              }, 3000);
            }, 500); // Reducido a 500ms para que cuelgue más rápido
            return; // Salir para evitar resetear isProcessingRef
          } else if (shouldHangupFinal) {
            // Segunda llamada: colgar definitivamente
            // Marcar como procesando para evitar que el micro se reactive
            isProcessingRef.current = true;
            // Cambiar el estado inmediatamente en el ref para que speakText lo detecte
            callStateRef.current = 'ended';
            setTimeout(() => {
              stopListening();
              // Parar audio completamente
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = '';
                audioRef.current.load();
              }
              setIsAISpeaking(false);
              setCallState('ended');
              // No hay llamada de seguimiento, termina aquí
              setTimeout(() => {
                callStateRef.current = 'idle';
                setCallState('idle');
                setMessages([]);
                setIsFollowupCall(false);
                setIsCallbackCall(false);
                previousMessagesRef.current = []; // Limpiar historial
                callbackTimeRef.current = '';
                callbackForTitularRef.current = false;
                isProcessingRef.current = false;
              }, 3000);
            }, 500); // Reducido a 500ms para que cuelgue más rápido
            return; // Salir para evitar resetear isProcessingRef
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
            }, 700);
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
  // Solo si la llamada está activa y no estamos en proceso de colgar
  useEffect(() => {
    if (callState === 'active' && !isAISpeaking && !isListening && !isProcessingRef.current) {
      const timeout = setTimeout(() => {
        // Verificar de nuevo antes de iniciar (por si cambió el estado)
        if (callState === 'active' && !isProcessingRef.current) {
          startListening();
        }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [callState, isAISpeaking, isListening, startListening]);

  const startCall = async () => {
    callStateRef.current = 'calling';
    setCallState('calling');
    ringStopRef.current = playRing();
    setTimeout(() => {
      ringStopRef.current?.();
      callStateRef.current = 'active';
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
    // Limpiar barge-in también
    if (bargeInStreamRef.current) {
      bargeInStreamRef.current.getTracks().forEach(t => t.stop());
      bargeInStreamRef.current = null;
    }
    if (bargeInContextRef.current?.state !== 'closed') {
      try { bargeInContextRef.current?.close(); } catch {}
    }
    bargeInContextRef.current = null;
    bargeInAnalyserRef.current = null;
    setIsAISpeaking(false);
  }, []);

  const endCall = () => {
    ringStopRef.current?.();
    // Cambiar ref inmediatamente para que otras funciones lo detecten
    callStateRef.current = 'ended';
    isProcessingRef.current = true;
    stopListening();
    stopAudio(); // Parar audio inmediatamente
    setCallState('ended');
    setIsFollowupCall(false);
    setIsCallbackCall(false);
    previousMessagesRef.current = [];
    callbackTimeRef.current = '';
    callbackForTitularRef.current = false;
    setTimeout(() => {
      callStateRef.current = 'idle';
      setCallState('idle');
      setMessages([]);
      isProcessingRef.current = false;
    }, 2000);
  };

  // Aceptar llamada entrante (followup o callback)
  const acceptIncomingCall = () => {
    ringStopRef.current?.();
    // Resetear estados para que el micrófono funcione
    isProcessingRef.current = false;
    callStateRef.current = 'active';
    setIsListening(false);
    setIsSpeaking(false);
    setIsAISpeaking(false);
    setCallState('active');
    setCallDuration(0);

    // Determinar qué mensaje usar según el tipo de llamada
    let greeting = '';
    if (isCallbackCall) {
      const hora = callbackTimeRef.current || 'esta hora';
      // Usar el ref que guardamos cuando se programó el callback
      const wasForTitular = callbackForTitularRef.current;

      if (wasForTitular) {
        // Callback para hablar con el titular - añadir contexto para GPT
        greeting = `¡Rubén! Soy Cristina, de Syntalys Tech. Me habías dicho que te llamara a las ${hora} que ya estaría tu padre por casa. ¿Está por ahí?`;
        // Añadir mensaje de contexto para que GPT entienda la situación
        const contexto = { role: 'user' as const, content: '[CONTEXTO: Esta es una llamada de callback. Rubén te dijo antes que su padre es el titular y que no estaba. Quedaste en llamar a esta hora para hablar con el padre. Si dice que sí está, pide que te lo pase y espera. Si dice que no está, pregunta a qué hora estará.]' };
        setMessages([contexto, { role: 'assistant', content: greeting }]);
      } else {
        // Callback normal (cliente no tenía tiempo)
        greeting = `¡Rubén! Soy Cristina, de Syntalys Tech. Habíamos quedado en hablar a las ${hora}. Bueno, pues como te dije, estamos revisando facturas de luz para ver si puedes ahorrar. ¿Eres el titular del contrato?`;
        setMessages([{ role: 'assistant', content: greeting }]);
      }
      // Limpiar estados de callback
      setIsCallbackCall(false);
      callbackTimeRef.current = '';
      callbackForTitularRef.current = false;
      previousMessagesRef.current = [];
    } else if (isFollowupCall) {
      // Llamada de followup normal (ya revisamos la factura)
      greeting = FOLLOWUP_GREETING;
      const historialPrevio = previousMessagesRef.current;
      setMessages([...historialPrevio, { role: 'assistant', content: greeting }]);
    }

    speakText(greeting);
  };

  // Rechazar llamada entrante
  const rejectIncomingCall = () => {
    ringStopRef.current?.();
    setCallState('idle');
    setIsFollowupCall(false);
    setIsCallbackCall(false);
    setMessages([]);
    previousMessagesRef.current = [];
    callbackTimeRef.current = '';
    callbackForTitularRef.current = false;
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

      {/* Notificación de WhatsApp */}
      {showWhatsAppNotification && (
        <div className="whatsapp-notification">
          <img src="/images/whatsapp-icon.png" alt="WhatsApp" className="whatsapp-icon" />
          <div className="whatsapp-content">
            <div className="whatsapp-header">
              <span className="whatsapp-name">Cristina - Syntalys</span>
              <span className="whatsapp-time">ahora</span>
            </div>
            <div className="whatsapp-message">
              Hola!!😊{'\n'}
              Soy Cristina, del departamento de energía.{'\n'}
              Para revisar tu ahorro, envíame por aquí una foto de tu factura de luz.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
