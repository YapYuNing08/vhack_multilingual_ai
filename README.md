# SilaSpeak 🇲🇾
**Empowering Malaysia's digitally vulnerable to navigate public services safely and conversationally.**

![SilaSpeak](https://img.shields.io/badge/Platform-React_Native_%7C_Expo-blue) ![Backend](https://img.shields.io/badge/Backend-FastAPI_%7C_Python-green) ![AI](https://img.shields.io/badge/AI-Groq_%7C_Llama3-orange) ![Database](https://img.shields.io/badge/Database-ChromaDB-purple)

*Built for the **Digital Inclusivity & Cybersecurity** Challenge Track.*

## 💡 The Problem
Accessing government aid in Malaysia often requires navigating rigid, multi-page web portals filled with bureaucratic jargon (*Bahasa Baku*). For the **B40 community, the elderly, and rural citizens**, this creates a massive digital divide. Language barriers, low digital literacy, and the rising threat of targeted financial scams (e.g., Macau Scams, fake STR SMS links) leave these vulnerable groups reliant on NGOs or completely cut off from the aid they legally deserve.

## 🚀 Our Solution
**SilaSpeak** is an AI-powered GovTech app acting as a digital social worker. It replaces complex government forms with a simple, familiar WhatsApp-style chat interface. Users can speak in their native tongue to ask questions, verify scams, and automatically generate ready-to-print official application forms.

### ✨ Key Features
* 🗣️ **Multilingual Voice Assistant:** Ask questions in English, Bahasa Malaysia, Mandarin, or Tamil. Features a hands-free "Voice Mode" powered by a **custom variance-based ambient silence detection** algorithm (2.5s threshold) for a seamless, walkie-talkie-free experience.
* 📝 **Smart Eligibility & Form Filler:** A built-in wizard pre-qualifies users for aid (like *Sumbangan Tunai Rahmah* - STR). Once eligible, the AI guides them through a chat to collect details and dynamically maps their answers onto an official, downloadable PDF form.
* 🛡️ **Scam Shield (Vision AI):** Users can snap a photo of suspicious official letters or paste SMS links. The vision pipeline actively extracts text, identifies exact fraud red flags (e.g., unofficial bank requests), and outputs a safety verdict.
* 📖 **Jargon Buster:** Automatically detects complex terms (e.g., *LHDN, MyKad, PTPTN*) and underlines them. Tapping the word reveals a simple, 1-sentence explanation.
* 🚨 **Offline SOS Lifeline:** A built-in emergency menu offering immediate, offline access to critical hotlines (999, NSRC 997, Talian Kasih 15999) with 1-tap direct dialing.
* 🔒 **Anti-Jailbreak Router:** A custom intent-classification router filters out off-topic questions, ensuring the AI remains strictly focused on Malaysian public services.

## 🛠️ System Architecture & Tech Stack

### Frontend (Mobile & Web)
* **Framework:** React Native & Expo.
* **Audio Handling:** `expo-av` for real-time audio metering and custom silence detection.
* **UI/UX:** Designed to mimic WhatsApp to leverage users' existing muscle memory, drastically reducing the learning curve for elderly users.

### Backend (API & Pipeline)
* **Framework:** Python & FastAPI.
* **RAG Pipeline:** Retrieval-Augmented Generation using **ChromaDB** and **SentenceTransformers**. We ingest official Malaysian government PDFs using a dual-fallback OCR system to ensure SilaSpeak provides factual, sourced advice rather than hallucinating policies.

### AI / LLM Infrastructure (Powered by Groq)
We rely on the Groq API for ultra-low latency inference, crucial for real-time voice conversations:
* **Core Chat & Routing:** `Llama3-8b` for conversational logic, jargon extraction, and intent classification.
* **Speech-to-Text:** `Whisper-large-v3-turbo` for instant, multilingual audio transcription.
* **Vision & OCR:** `Llama-4-scout` for document scanning, OCR, and advanced fraud pattern recognition.
* **Prompt Engineering:** Heavily tuned system prompts specifically anchored to Malaysian law, barring US-centric hallucinations (e.g., forcing "STR" to mean Sumbangan Tunai Rahmah, not a visa pass).

## ⚙️ How to Run Locally

### 1. Backend Setup (FastAPI)
```bash
# Clone the repository
git clone [https://github.com/YapYuNing08/vhack_multilingual_ai.git]
cd silaspeak/backend

# Install dependencies
pip install -r requirements.txt

# Set your Groq API Key
export GROQ_API_KEY="your_api_key_here"

# Run the server (Make sure your laptop and phone are on the SAME Wi-Fi)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```        
           
### 1. Frontend Setup (React Native / Expo)    
```bash
# Install dependencies
npm install

# Command Prompt: ipconfig
Look for "Wireless LAN adapter Wi-Fi: IPv4 address"

# Update the IP Address
# Open App.js and change `BACKEND_URL` to match your laptop's IPv4 address.
# e.g., const BACKEND_URL = '[http://192.168.](http://192.168.)X.X:8000';

# Start the Expo development server
npx expo start
```
