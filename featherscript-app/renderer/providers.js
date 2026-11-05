// Supported chats and explicitly marked external websites. No remote logo requests.
globalThis.FSAIProviders = Object.freeze([
  { id: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com', url: 'https://chatgpt.com/', mark: 'GPT', color: '#10a37f', detail: 'OpenAI' },
  { id: 'aistudio', name: 'Google AI Studio', host: 'aistudio.google.com', url: 'https://aistudio.google.com/prompts/new_chat', mark: 'AI', color: '#4285f4', detail: 'Google · developer studio' },
  { id: 'genspark', name: 'Genspark AI Chat', host: 'www.genspark.ai', url: 'https://www.genspark.ai/agents?type=ai_chat', mark: 'GS', color: '#a78bfa', detail: 'Genspark · preview support' },
  { id: 'gemini', name: 'Gemini', host: 'gemini.google.com', url: 'https://gemini.google.com/app', mark: 'G', color: '#8b7cf8', detail: 'Google' },
  { id: 'mimo', name: 'MiMo AI', host: 'aistudio.xiaomimimo.com', url: 'https://aistudio.xiaomimimo.com/', mark: 'Mi', color: '#ff8a4c', detail: 'Xiaomi · MiMo Studio' },
  { id: 'deepseek', name: 'DeepSeek', host: 'chat.deepseek.com', url: 'https://chat.deepseek.com/', mark: 'DS', color: '#538bff', detail: 'DeepSeek chat' },
  { id: 'arena', name: 'Arena', host: 'arena.ai', url: 'https://arena.ai/text/direct', mark: 'A', color: '#d3a95b', detail: 'Use Direct chat mode' },
  { id: 'kimi', name: 'Kimi', host: 'www.kimi.ai', url: 'https://www.kimi.ai/', mark: 'K', color: '#79a3ff', detail: 'Moonshot AI' },
  { id: 'qwen', name: 'Qwen', host: 'chat.qwen.ai', url: 'https://chat.qwen.ai/', mark: 'Q', color: '#a78bfa', detail: 'Alibaba · Qwen Chat' },
  { id: 'glm', name: 'GLM', host: 'chat.z.ai', url: 'https://chat.z.ai/', mark: 'Z', color: '#48b7c5', detail: 'Z.ai' },
  { id: 'meta', name: 'Meta AI', host: 'meta.ai', url: 'https://www.meta.ai/', mark: 'M', color: '#5487ff', detail: 'Meta' },
  { id: 'vani', name: 'Vani Chat', host: 'c.vani.ai', url: 'https://c.vani.ai/chat', mark: 'V', color: '#e17abb', detail: 'Vani' },
  { id: 'notion', name: 'Notion AI', host: 'www.notion.so', url: 'https://www.notion.so/chat', mark: 'N', color: '#94a3b8', detail: 'Notion chat' },
  { id: 'freebuff', name: 'Freebuff', host: 'freebuff.com', url: 'https://freebuff.com/', mark: 'F', color: '#6ee7b7', detail: 'External website', external: true },
].map(Object.freeze));
