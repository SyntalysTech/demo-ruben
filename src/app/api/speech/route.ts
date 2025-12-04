import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_VOICE_ID = '1eHrpOW5l98cxiSRjbzJ';

export async function POST(request: NextRequest) {
  try {
    const { text, voiceId } = await request.json() as { text: string; voiceId?: string };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || DEFAULT_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_APIKEY || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.85,        // Alta estabilidad para evitar "eeee" y divagaciones
            similarity_boost: 0.75, // Mantener la voz similar
            style: 0.0,             // Sin estilo extra para evitar sonidos raros
            use_speaker_boost: true // Mejorar claridad
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs error:', error);
      throw new Error('ElevenLabs API error');
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('Speech API error:', error);
    return NextResponse.json(
      { error: 'Error generating speech' },
      { status: 500 }
    );
  }
}
