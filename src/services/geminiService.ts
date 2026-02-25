import { GoogleGenAI, Type, ThinkingLevel, Modality, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const MODELS = {
  CHAT: "gemini-3.1-pro-preview",
  SEARCH: "gemini-3-flash-preview",
  MAPS: "gemini-2.5-flash",
  FAST: "gemini-2.5-flash-lite",
  TRANSCRIPTION: "gemini-3-flash-preview",
  TTS: "gemini-2.5-flash-preview-tts",
  IMAGE: "gemini-3-pro-image-preview",
};

export interface Message {
  role: "user" | "model";
  content: string;
  type?: "text" | "image" | "audio" | "generated_image";
  metadata?: any;
}

export async function chatWithGemini(
  message: string,
  history: Message[] = [],
  options: {
    useSearch?: boolean;
    useMaps?: boolean;
    useThinking?: boolean;
    useFast?: boolean;
    image?: { data: string; mimeType: string };
    location?: { latitude: number; longitude: number };
  } = {}
) {
  const modelName = options.useFast 
    ? MODELS.FAST 
    : (options.useMaps ? MODELS.MAPS : (options.useSearch ? MODELS.SEARCH : MODELS.CHAT));

  const config: any = {};
  
  // Set thinking level to HIGH for gemini-3.1-pro-preview when thinking mode is requested
  if (options.useThinking && modelName === MODELS.CHAT) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
  }

  if (options.useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  if (options.useMaps) {
    config.tools = [{ googleMaps: {} }];
    if (options.location) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: options.location
        }
      };
    }
  }

  const contents: any[] = history.map(h => ({
    role: h.role,
    parts: [{ text: h.content }]
  }));

  const currentParts: any[] = [{ text: message }];
  if (options.image) {
    currentParts.push({
      inlineData: {
        data: options.image.data,
        mimeType: options.image.mimeType
      }
    });
  }

  contents.push({ role: "user", parts: currentParts });

  const response = await ai.models.generateContent({
    model: modelName,
    contents,
    config
  });

  return response;
}

export async function generateImage(prompt: string, aspectRatio: string = "1:1") {
  // Use a fresh instance for image generation to ensure latest API key is used
  const imageAi = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || "" });
  const response = await imageAi.models.generateContent({
    model: MODELS.IMAGE,
    contents: { parts: [{ text: prompt }] },
    config: {
      imageConfig: {
        aspectRatio: aspectRatio as any,
      },
    },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  throw new Error("No image generated");
}

export async function transcribeAudio(audioBase64: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: MODELS.TRANSCRIPTION,
    contents: [
      {
        parts: [
          { text: "Please transcribe this audio accurately." },
          { inlineData: { data: audioBase64, mimeType } }
        ]
      }
    ]
  });
  return response.text;
}

export async function generateSpeech(text: string) {
  const response = await ai.models.generateContent({
    model: MODELS.TTS,
    contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
