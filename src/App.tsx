/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Mic, 
  Image as ImageIcon, 
  Search, 
  MapPin, 
  Zap, 
  Brain, 
  Volume2, 
  Trash2, 
  Loader2,
  Globe,
  Navigation,
  MicOff,
  Palette,
  Maximize2,
  Share2,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { chatWithGemini, generateSpeech, transcribeAudio, generateImage, Message } from './services/geminiService';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useSearch, setUseSearch] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [useThinking, setUseThinking] = useState(false);
  const [useFast, setUseFast] = useState(false);
  const [isImageMode, setIsImageMode] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("1:1");
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (useMaps && !location) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.error("Location error:", err)
      );
    }
  }, [useMaps]);

  const checkApiKey = async () => {
    if (isImageMode) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        // Assume success as per guidelines
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !selectedImage) return;

    if (isImageMode) {
      await checkApiKey();
      const userMessage: Message = {
        role: 'user',
        content: `Generate an image: ${input} (${selectedAspectRatio})`,
        type: 'text'
      };
      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);

      try {
        const imageData = await generateImage(input, selectedAspectRatio);
        const modelResponse: Message = {
          role: 'model',
          content: "Here is your generated image:",
          type: 'generated_image',
          metadata: { generatedImage: imageData }
        };
        setMessages(prev => [...prev, modelResponse]);
      } catch (error: any) {
        console.error("Image generation error:", error);
        if (error.message?.includes("Requested entity was not found")) {
          await window.aistudio.openSelectKey();
        }
        setMessages(prev => [...prev, { role: 'model', content: "Sorry, I couldn't generate the image. Please check your API key or try a different prompt." }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: input,
      type: selectedImage ? 'image' : 'text',
      metadata: selectedImage ? { image: selectedImage.data } : null
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await chatWithGemini(input, messages, {
        useSearch,
        useMaps,
        useThinking,
        useFast,
        image: selectedImage || undefined,
        location: location || undefined
      });

      const modelResponse: Message = {
        role: 'model',
        content: response.text || "I couldn't generate a response.",
        metadata: {
          groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks
        }
      };

      setMessages(prev => [...prev, modelResponse]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { role: 'model', content: "Sorry, an error occurred while processing your request." }]);
    } finally {
      setIsLoading(false);
      setSelectedImage(null);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          data: (reader.result as string).split(',')[1],
          mimeType: file.type
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setIsLoading(true);
          try {
            const transcription = await transcribeAudio(base64, 'audio/webm');
            setInput(transcription || '');
          } catch (error) {
            console.error("Transcription error:", error);
          } finally {
            setIsLoading(false);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Mic error:", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const playTTS = async (text: string) => {
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        audio.play();
      }
    } catch (error) {
      console.error("TTS error:", error);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#f5f5f5] font-sans text-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Zap className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">OmniMind AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setMessages([])}
            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
            title="Clear Chat"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
            <div className="p-4 bg-white rounded-full shadow-sm">
              <Zap size={48} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-2xl font-medium">How can I help you today?</h2>
              <p className="text-slate-500 max-w-md mx-auto mt-2">
                Ask me anything, upload images, or use my advanced search and mapping capabilities.
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-4 shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-white text-slate-800 border border-slate-200'
              }`}>
                {msg.metadata?.image && (
                  <img 
                    src={`data:image/png;base64,${msg.metadata.image}`} 
                    alt="Uploaded" 
                    className="rounded-lg mb-3 max-h-64 object-cover"
                    referrerPolicy="no-referrer"
                  />
                )}
                {msg.type === 'generated_image' && msg.metadata?.generatedImage && (
                  <img 
                    src={`data:image/png;base64,${msg.metadata.generatedImage}`} 
                    alt="Generated" 
                    className="rounded-lg mb-3 w-full object-contain shadow-lg"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="prose prose-slate max-w-none prose-sm md:prose-base">
                  <Markdown>{msg.content}</Markdown>
                </div>
                
                {msg.role === 'model' && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-wrap gap-2">
                      {msg.metadata?.groundingChunks?.map((chunk: any, idx: number) => (
                        chunk.web && (
                          <a 
                            key={idx} 
                            href={chunk.web.uri} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200 transition-colors flex items-center gap-1"
                          >
                            <Globe size={10} /> {chunk.web.title || 'Source'}
                          </a>
                        )
                      ))}
                      {msg.metadata?.groundingChunks?.map((chunk: any, idx: number) => (
                        chunk.maps && (
                          <a 
                            key={`map-${idx}`} 
                            href={chunk.maps.uri} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1"
                          >
                            <Navigation size={10} /> {chunk.maps.title || 'Location'}
                          </a>
                        )
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <ShareButton text={msg.content} />
                      <button 
                        onClick={() => playTTS(msg.content)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
                        title="Read Aloud"
                      >
                        <Volume2 size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              <span className="text-sm text-slate-500">
                {isImageMode ? "Creating your masterpiece..." : "Thinking..."}
              </span>
            </div>
          </motion.div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Toggles */}
          <div className="flex flex-wrap gap-2 justify-center">
            <Toggle 
              active={useFast} 
              onClick={() => { setUseFast(!useFast); setUseThinking(false); setIsImageMode(false); }} 
              icon={<Zap size={14} />} 
              label="Fast" 
              color="text-amber-600"
              bg="bg-amber-50"
              activeBg="bg-amber-100"
            />
            <Toggle 
              active={useThinking} 
              onClick={() => { setUseThinking(!useThinking); setUseFast(false); setIsImageMode(false); }} 
              icon={<Brain size={14} />} 
              label="Think" 
              color="text-purple-600"
              bg="bg-purple-50"
              activeBg="bg-purple-100"
            />
            <Toggle 
              active={isImageMode} 
              onClick={async () => { 
                const next = !isImageMode;
                setIsImageMode(next); 
                if (next) {
                  setUseFast(false);
                  setUseThinking(false);
                  setUseSearch(false);
                  setUseMaps(false);
                  await checkApiKey();
                }
              }} 
              icon={<Palette size={14} />} 
              label="Create" 
              color="text-pink-600"
              bg="bg-pink-50"
              activeBg="bg-pink-100"
            />
            <Toggle 
              active={useSearch} 
              onClick={() => { setUseSearch(!useSearch); setIsImageMode(false); }} 
              icon={<Search size={14} />} 
              label="Search" 
              color="text-blue-600"
              bg="bg-blue-50"
              activeBg="bg-blue-100"
            />
            <Toggle 
              active={useMaps} 
              onClick={() => { setUseMaps(!useMaps); setIsImageMode(false); }} 
              icon={<MapPin size={14} />} 
              label="Maps" 
              color="text-emerald-600"
              bg="bg-emerald-50"
              activeBg="bg-emerald-100"
            />
          </div>

          {/* Aspect Ratio Selector */}
          <AnimatePresence>
            {isImageMode && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2 justify-center overflow-hidden"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mr-2">
                  <Maximize2 size={12} /> Aspect Ratio:
                </div>
                {ASPECT_RATIOS.map(ratio => (
                  <button
                    key={ratio}
                    onClick={() => setSelectedAspectRatio(ratio)}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                      selectedAspectRatio === ratio 
                        ? 'bg-pink-600 text-white border-pink-600' 
                        : 'bg-white text-slate-500 border-slate-200 hover:border-pink-300'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Box */}
          <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all">
            <div className="flex flex-col flex-1">
              {selectedImage && (
                <div className="p-2 mb-2 relative group w-fit">
                  <img 
                    src={`data:image/png;base64,${selectedImage.data}`} 
                    alt="Preview" 
                    className="h-20 w-20 object-cover rounded-lg border border-slate-200"
                  />
                  <button 
                    onClick={() => setSelectedImage(null)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={isImageMode ? "Describe the image you want to create..." : "Ask OmniMind anything..."}
                className="w-full bg-transparent border-none focus:ring-0 resize-none py-2 px-3 text-slate-800 min-h-[44px] max-h-40"
                rows={1}
              />
            </div>

            <div className="flex items-center gap-1 pb-1 pr-1">
              {!isImageMode && (
                <>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl transition-all"
                    title="Upload Image"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    className="hidden" 
                    accept="image/*"
                  />
                  
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`p-2 rounded-xl transition-all ${
                      isRecording 
                        ? 'bg-red-100 text-red-600 animate-pulse' 
                        : 'text-slate-400 hover:text-indigo-600 hover:bg-white'
                    }`}
                    title={isRecording ? "Stop Recording" : "Voice Input"}
                  >
                    {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                </>
              )}

              <button 
                onClick={handleSend}
                disabled={isLoading || (!input.trim() && !selectedImage)}
                className={`p-2 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm ${
                  isImageMode ? 'bg-pink-600 hover:bg-pink-700' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  return (
    <button 
      onClick={handleCopy}
      className={`p-1.5 transition-colors ${copied ? 'text-emerald-500' : 'text-slate-400 hover:text-indigo-600'}`}
      title="Copy to Clipboard"
    >
      {copied ? <Check size={16} /> : <Share2 size={16} />}
    </button>
  );
}

function Toggle({ active, onClick, icon, label, color, bg, activeBg }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
        active 
          ? `${activeBg} ${color} border-current` 
          : `${bg} text-slate-500 border-transparent hover:border-slate-300`
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
