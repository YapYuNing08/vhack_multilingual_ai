# SilaSpeak 🇲🇾
**Empowering Malaysia's digitally vulnerable to navigate public services safely and conversationally.**

![SilaSpeak](https://img.shields.io/badge/Platform-React_Native_%7C_Expo-blue) ![Backend](https://img.shields.io/badge/Backend-FastAPI_%7C_Python-green) ![AI](https://img.shields.io/badge/AI-Groq_%7C_Llama3-orange) 

## 💡 The Problem
Accessing government aid in Malaysia often requires navigating rigid, multi-page web portals filled with bureaucratic jargon (*Bahasa Baku*). For the **B40 community, the elderly, and rural citizens**, this creates a massive digital divide. Language barriers, low digital literacy, and the rising threat of targeted financial scams (e.g., Macau Scams, fake STR SMS links) leave these vulnerable groups reliant on NGOs or completely cut off from the aid they legally deserve.

## 🚀 Our Solution
**SilaSpeak** is an AI-powered GovTech app acting as a digital social worker. It replaces complex government forms with a simple, familiar WhatsApp-style chat interface. Users can speak in their native tongue to ask questions, verify scams, and automatically generate ready-to-print official application forms.

### ✨ Key Features
* 🗣️ **Multilingual Voice Assistant:** Ask questions in English, Bahasa Malaysia, Mandarin, or Tamil. Features a hands-free "Voice Mode" for low-literacy users.
* 📝 **Smart Eligibility & Form Filler:** A built-in wizard pre-qualifies users for aid (like *Sumbangan Tunai Rahmah* - STR). Once eligible, the AI guides them through a chat to collect details and outputs a perfectly formatted, downloadable PDF form.
* 🛡️ **Scam Shield:** Users can paste suspicious SMS links or messages. The AI instantly flags phishing attempts, .APK viruses, and mule account traps, advising them to contact the NSRC (997).
* 📄 **Vision Document Scanner:** Snap a photo of a confusing official government letter. SilaSpeak reads it and provides a 3-bullet-point summary in plain language.
* 📖 **Jargon Buster:** Automatically detects complex terms (e.g., *LHDN, MyKad, PTPTN*) and underlines them. Tapping the word reveals a simple, 1-sentence explanation.
* 🚨 **Offline SOS Lifeline:** A built-in emergency menu offering immediate, offline access to critical hotlines (999, NSRC 997, Talian Kasih 15999) with 1-tap dialing.
* 📱 **Elderly-Friendly UI:** Designed to mimic WhatsApp to leverage users' existing muscle memory, drastically reducing the learning curve.

## 🛠️ Tech Stack
* **Frontend:** React Native, Expo (`expo-av` for audio metering/recording, `expo-speech` for TTS, `expo-file-system` for multipart uploads).
* **Backend:** Python, FastAPI.
* **AI / LLM Infrastructure:** * **LLM Engine:** Groq API (Llama 3) for ultra-low latency conversational responses and jargon extraction.
  * **Audio:** Whisper API (Voice-to-Text transcription).
  * **Prompt Engineering:** Heavily tuned system prompts specifically anchored to Malaysian law, barring US-centric hallucinations (e.g., forcing "STR" to mean Sumbangan Tunai Rahmah, not a visa pass).

## 💼 Market Strategy & Business Model
SilaSpeak targets **SDG 10 (Reduced Inequalities)** and remains **100% free for end-users**. It is sustained via a dual-pronged enterprise model:
1.  **B2G (GovTech Licensing):** White-labeling the API to government agencies (MAMPU, LHDN) to reduce call-center congestion and physical queues at UTCs.
2.  **B2B (CSR/ESG Sponsorships):** Partnering with major Malaysian banks and Telcos. They subsidize server costs via their ESG budgets to deploy SilaSpeak's **Scam Shield**, protecting their customers from financial fraud.

## ⚙️ How to Run Locally

### Prerequisites
* Node.js & npm
* Python 3.10+
* Expo CLI (`npm install -g expo-cli`)
* Groq API Key

### 1. Backend Setup (FastAPI)
```bash
# Clone the repository
git clone [https://github.com/yourusername/silaspeak.git](https://github.com/yourusername/silaspeak.git)
cd silaspeak/backend

# Install dependencies
pip install -r requirements.txt

# Set your Groq API Key
export GROQ_API_KEY="your_api_key_here"

# Run the server (Make sure your laptop and phone are on the SAME Wi-Fi)
uvicorn app.main:app --host 0.0.0.0 --port 8000
