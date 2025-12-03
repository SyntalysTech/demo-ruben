import { NextRequest, NextResponse } from 'next/server';

const LANGUAGE_CODES: Record<string, string> = {
  es: 'es',
  fr: 'fr',
  de: 'de'
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const language = formData.get('language') as string || 'es';

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    const openaiFormData = new FormData();
    openaiFormData.append('file', audioFile, 'audio.webm');
    openaiFormData.append('model', 'whisper-1');
    openaiFormData.append('language', LANGUAGE_CODES[language] || 'es');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_APIKEY}`,
      },
      body: openaiFormData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Whisper error:', error);
      throw new Error('Whisper API error');
    }

    const data = await response.json();
    return NextResponse.json({ text: data.text });
  } catch (error) {
    console.error('Transcribe API error:', error);
    return NextResponse.json(
      { error: 'Error transcribing audio' },
      { status: 500 }
    );
  }
}
