import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Modal, Linking
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons'; // ✅ Added for WhatsApp UI
import { styles, voiceStyles, eligStyles, docStyles } from './styles';
import { EMERGENCY_FAQS } from './faqs';
import DocumentsDrawer from './DocumentsDrawer'; 

// ── Silence detection config ──────────────────────────────────────────────────
const SILENCE_DURATION_MS    = 2500;
const SILENCE_CHECK_INTERVAL = 150;
const MIC_WARMUP_MS          = 300;
const ENERGY_HISTORY_SIZE    = 20;
const VARIANCE_THRESHOLD     = 0.0008;
const BASELINE_FRAMES        = 5;

export default function App() {
  const BACKEND_URL = 'http://192.168.68.109:8000'; // ⚠️ Replace with your IPv4

  // ── Screens: 'chat' | 'eligibility' | 'form' ─────────────────────────────
  const [screen, setScreen] = useState('chat');

  // ── Chat state ────────────────────────────────────────────────────────────
  const initialMessage = {
    id: 1,
    text: "Welcome to SilaSpeak! 🇲🇾\nAsk me anything about Malaysian government services in ANY language.\n\nTap 📷 to scan a document, or tap 📝 'Help me apply' to auto-fill forms for STR, PeKa B40, SARA, and more!\n\nTip: Underlined words are jargon — tap them for a quick explanation!",
    sender: "bot", jargon: {}, isScam: false, scamResult: null,
  };

  const [messages,      setMessages]      = useState([initialMessage]);
  const [inputText,     setInputText]     = useState("");
  const [isLoading,     setIsLoading]     = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [language,      setLanguage]      = useState("en");  
  const [visionContext, setVisionContext] = useState(null);
  const [jargonSheet,   setJargonSheet]   = useState({ visible: false, term: "", explanation: "" });
  const [scamSheet,     setScamSheet]     = useState({ visible: false, data: null });
  const [sosSheet,      setSosSheet]      = useState(false);
  const [showDocs,      setShowDocs]      = useState(false); 

  // ── Voice Mode state ──────────────────────────────────────────────────────
  const [voiceMode,        setVoiceMode]        = useState(false);
  const [voiceStatus,      setVoiceStatus]      = useState("idle");
  const [silenceCountdown, setSilenceCountdown] = useState(null);

  // ── Eligibility Checker state ─────────────────────────────────────────────
  const [eligMessages,  setEligMessages]  = useState([]);
  const [eligInput,     setEligInput]     = useState("");
  const [eligLoading,   setEligLoading]   = useState(false);
  const [eligStep,      setEligStep]      = useState(0);
  const [eligCollected, setEligCollected] = useState({});
  const [eligComplete,  setEligComplete]  = useState(false);
  const [eligResult,    setEligResult]    = useState(null);
  const [eligLanguage,  setEligLanguage]  = useState("en");

  // ── Form Filler state ─────────────────────────────────────────────────────
  const [formMessages,  setFormMessages]  = useState([]);
  const [formInput,     setFormInput]     = useState("");
  const [formLoading,   setFormLoading]   = useState(false);
  const [formField,     setFormField]     = useState(0);
  const [formCollected, setFormCollected] = useState({});
  const [formComplete,  setFormComplete]  = useState(false);
  const [formLanguage,  setFormLanguage]  = useState("en");
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const scrollViewRef    = useRef();
  const eligScrollRef    = useRef();
  const formScrollRef    = useRef();
  const recordingRef     = useRef(null);
  const historyRef       = useRef([]);
  const voiceModeRef     = useRef(false);
  const silenceMsRef     = useRef(0);
  const hasSpeechRef     = useRef(false);
  const silenceCheckRef  = useRef(null);
  const energyHistoryRef = useRef([]);
  const baselineEnergyRef= useRef(0);
  const baselineFramesRef= useRef(0);
  const audioChunksRef   = useRef([]);
  const mediaRecorderRef = useRef(null);
  const micStreamRef     = useRef(null);
  const audioContextRef  = useRef(null);
  const analyserRef      = useRef(null);

  const LANGUAGES = [
    { code: "en", label: "EN" },
    { code: "ms", label: "MS" },
    { code: "zh", label: "中文" },
    { code: "ta", label: "தமிழ்" },
  ];

  const uiLangMap = { en: "en-US", ms: "ms-MY", zh: "zh-CN", ta: "ta-IN" };

  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  useEffect(() => () => clearSilenceDetection(), []);

  // ── Silence detection helpers ─────────────────────────────────────────────
  const clearSilenceDetection = () => {
    if (silenceCheckRef.current) { clearInterval(silenceCheckRef.current); silenceCheckRef.current = null; }
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
    analyserRef.current       = null;
    silenceMsRef.current      = 0;
    hasSpeechRef.current      = false;
    energyHistoryRef.current  = [];
    baselineEnergyRef.current = 0;
    baselineFramesRef.current = 0;
    setSilenceCountdown(null);
  };

  // ── Chat helpers ──────────────────────────────────────────────────────────
  const clearChat = () => { setMessages([initialMessage]); historyRef.current = []; setVisionContext(null); };

  const speakMessage = (text) => {
    const clean = String(text || "")
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/gu, '')
      .replace(/[•·●◆✦✅🔴🟡🟢]/gu, '').replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '').replace(/\s+/g, ' ').trim();
    Speech.stop();
    Speech.speak(clean, { language: uiLangMap[language] || "en-US", rate: 0.9 });
  };

  const stopSpeaking = () => Speech.stop();

  const scamRiskColor = (level) => ({
    HIGH: "#c62828", MEDIUM: "#e65100", LOW: "#f9a825", SAFE: "#2e7d32"
  }[level] || "#757575");

  const scamRiskEmoji = (level) => ({
    HIGH: "🚨", MEDIUM: "⚠️", LOW: "🔍", SAFE: "✅"
  }[level] || "❓");

  const triggerScamSheet = (scamData, delay = 0) => {
    if (!scamData) return;
    const risk = scamData.risk_level || scamData.risk;
    if (risk && risk !== "SAFE" && risk !== "UNKNOWN") {
      setTimeout(() => setScamSheet({ visible: true, data: scamData }), delay);
    }
  };

  const renderMessageWithJargon = (text, jargon, isScam) => {
    const safeText   = (text != null) ? String(text) : "";
    const safeJargon = (jargon && typeof jargon === 'object') ? jargon : {};
    const baseStyle  = [styles.messageText, isScam && styles.scamMessageText];
    const terms      = Object.keys(safeJargon);
    if (terms.length === 0) return <Text style={baseStyle} selectable>{safeText}</Text>;
    try {
      const pattern = new RegExp(
        `(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'
      );
      const parts = safeText.split(pattern);
      return (
        <Text style={baseStyle} selectable>
          {parts.map((part, i) => {
            if (part == null || part === '') return null;
            const match = terms.find(t => t.toLowerCase() === part.toLowerCase());
            if (match) {
              return (
                <Text key={i} style={styles.jargonUnderline}
                  onPress={() => setJargonSheet({ visible: true, term: String(match), explanation: String(safeJargon[match] || "") })}>
                  {String(part)}
                </Text>
              );
            }
            return <Text key={i}>{String(part)}</Text>;
          })}
        </Text>
      );
    } catch { return <Text style={baseStyle} selectable>{safeText}</Text>; }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ELIGIBILITY CHECKER
  // ══════════════════════════════════════════════════════════════════════════
  const startEligibilityChecker = async (lang = "en") => {
    setScreen('eligibility');
    setEligMessages([]);
    setEligStep(0);
    setEligCollected({});
    setEligComplete(false);
    setEligResult(null);
    setEligLanguage(lang);
    setEligLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/eligibility/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_answer: null, current_step: 0, collected: {}, language: lang }),
      });
      const data = await res.json();
      const intro = {
        en: "👋 Hi! Before filling any form, let me check if you qualify.\n\n",
        ms: "👋 Hai! Sebelum mengisi borang, izinkan saya semak kelayakan anda.\n\n",
        zh: "👋 您好！在填写表格之前，让我先检查您的资格。\n\n",
        ta: "👋 வணக்கம்! படிவம் நிரப்பும் முன், உங்கள் தகுதியை சரிபார்க்கிறேன்.\n\n",
      };
      setEligMessages([{ id: Date.now(), text: (intro[lang] || intro.en) + (data.question || ""), sender: "bot" }]);
      setEligStep(data.current_step);
    } catch {
      Alert.alert("Error", "Could not connect to server.");
      setScreen('chat');
    } finally { setEligLoading(false); }
  };

  const sendEligibilityAnswer = async () => {
    const answer = eligInput.trim();
    if (!answer) return;
    setEligMessages(prev => [...prev, { id: Date.now(), text: answer, sender: "user" }]);
    setEligInput("");
    setEligLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/eligibility/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_answer: answer, current_step: eligStep, collected: eligCollected, language: eligLanguage }),
      });
      const data = await res.json();
      setEligStep(data.current_step);
      setEligCollected(data.collected || {});
      if (data.is_complete && data.result) {
        setEligComplete(true);
        setEligResult(data.result);
        setEligMessages(prev => [...prev, {
          id: Date.now() + 1,
          text: data.result.result_label + "\n\n" + data.result.details,
          sender: "bot",
          resultType: data.result.eligible ? "eligible" : "not_eligible",
        }]);
      } else {
        setEligMessages(prev => [...prev, { id: Date.now() + 1, text: data.question || "", sender: "bot" }]);
      }
    } catch {
      setEligMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, something went wrong. Please try again.", sender: "bot" }]);
    } finally { setEligLoading(false); }
  };

  const proceedToForm = () => {
    const preCollected = {};
    if (eligCollected.monthly_income != null)
      preCollected.pendapatan_bulanan = String(eligCollected.monthly_income);
    if (eligCollected.marital_status) {
      const map = { single: "Bujang", married: "Berkahwin", divorced: "Bercerai", widowed: "Balu/Duda" };
      preCollected.status_perkahwinan = map[eligCollected.marital_status] || eligCollected.marital_status;
    }
    setFormLanguage(eligLanguage);
    setScreen('form');
    _startFormWithPrefill(preCollected, eligLanguage);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORM FILLER
  // ══════════════════════════════════════════════════════════════════════════
  const startFormFiller = async () => _startFormWithPrefill({}, formLanguage);

  const _startFormWithPrefill = async (prefilled, lang) => {
    setFormMessages([]);
    setFormCollected(prefilled);
    setFormComplete(false);
    setFormLoading(true);
    setFormField(0);

    const hasPrefill = Object.keys(prefilled).length > 0;
    const introText = {
      en: hasPrefill
        ? "📝 Great! I've already noted your income and marital status. Now I just need a few more details."
        : "📝 Let's fill in your Borang STR together!\nI'll ask you questions one at a time. Reply in any language!",
      ms: hasPrefill
        ? "📝 Bagus! Saya telah mencatat pendapatan dan status perkahwinan anda. Saya hanya perlukan beberapa maklumat lagi."
        : "📝 Mari kita isi Borang STR anda bersama-sama!\nSaya akan bertanya soalan satu demi satu.",
      zh: hasPrefill
        ? "📝 很好！我已记录了您的收入和婚姻状况。现在只需要再填几项信息。"
        : "📝 让我们一起填写STR表格！\n我会逐一提问。",
      ta: hasPrefill
        ? "📝 நன்று! வருமானம் மற்றும் திருமண நிலை குறித்துக் கொண்டேன். இனி சில விவரங்கள் மட்டும்."
        : "📝 STR படிவத்தை ஒன்றாக நிரப்புவோம்!\nஒவ்வொரு கேள்வியாக கேட்கிறேன்.",
    };

    console.log("[Form] prefilled:", prefilled);
    try {
      const res = await fetch(`${BACKEND_URL}/form/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_answer: null, current_field: 0, collected: prefilled, language: lang }),
      });
      const data = await res.json();
      setFormMessages([{ id: Date.now(), text: (introText[lang] || introText.en) + "\n\n" + (data.question || ""), sender: "bot" }]);
      setFormField(data.current_field);
    } catch {
      Alert.alert("Error", "Could not connect to server.");
      setScreen('chat');
    } finally { setFormLoading(false); }
  };

  const sendFormAnswer = async () => {
    const answer = formInput.trim();
    if (!answer) return;
    setFormMessages(prev => [...prev, { id: Date.now(), text: answer, sender: "user" }]);
    setFormInput("");
    setFormLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/form/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_answer: answer, current_field: formField, collected: formCollected, language: formLanguage }),
      });
      const data = await res.json();
      setFormField(data.current_field);
      setFormCollected(data.collected || {});
      setFormComplete(data.is_complete || false);
      setFormMessages(prev => [...prev, { id: Date.now() + 1, text: data.question || "", sender: "bot", isComplete: data.is_complete }]);
    } catch {
      setFormMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, something went wrong.", sender: "bot" }]);
    } finally { setFormLoading(false); }
  };

  const downloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      const tempPath = FileSystem.cacheDirectory + 'Borang_STR_SilaSpeak.pdf';
      const params = [
        `nama_penuh=${encodeURIComponent(formCollected.nama_penuh || '')}`,
        `no_mykad=${encodeURIComponent(formCollected.no_mykad || '')}`,
        `no_telefon=${encodeURIComponent(formCollected.no_telefon || '')}`,
        `emel=${encodeURIComponent(formCollected.emel || '')}`,
        `pendapatan_bulanan=${encodeURIComponent(formCollected.pendapatan_bulanan || '')}`,
        `status_perkahwinan=${encodeURIComponent(formCollected.status_perkahwinan || '')}`,
        `language=${encodeURIComponent(formLanguage)}`,
      ].join('&');
      const downloadResult = await FileSystem.downloadAsync(`${BACKEND_URL}/form/generate-get?${params}`, tempPath);
      if (downloadResult.status !== 200) throw new Error(`Download failed`);
      await Sharing.shareAsync(downloadResult.uri, { mimeType: 'application/pdf', dialogTitle: 'Save your STR Form', UTI: 'com.adobe.pdf' });
    } catch (e) { Alert.alert("Error", "Could not generate PDF."); }
    finally { setGeneratingPDF(false); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE-TO-TEXT (push-to-talk)
  // ══════════════════════════════════════════════════════════════════════════
  const handleMicPress = async () => { if (isRecording) await stopVoiceToText(); else await startVoiceToText(); };

  const startVoiceToText = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("Permission needed", "Microphone access required."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) { console.error(err); }
  };

  const stopVoiceToText = async () => {
    if (!recordingRef.current) return;
    setIsRecording(false); setIsLoading(true);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI(); recordingRef.current = null;
      if (!uri) return;
      await new Promise(r => setTimeout(r, 500));
      const fd = new FormData(); fd.append("file", { uri, name: "voice.m4a", type: "audio/m4a" });
      const res = await fetch(`${BACKEND_URL}/transcribe/`, { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.text?.trim()) setInputText(data.text.trim());
      else Alert.alert("No Speech", "Could not detect speech.");
    } catch { Alert.alert("Voice Error", "Could not transcribe audio."); }
    finally { setIsLoading(false); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE MODE (hands-free loop)
  // ══════════════════════════════════════════════════════════════════════════
  const toggleVoiceMode = async () => {
    if (voiceMode) {
      voiceModeRef.current = false;
      setVoiceMode(false); setVoiceStatus("idle"); setIsRecording(false);
      clearSilenceDetection(); Speech.stop();
      if (recordingRef.current) { try { await recordingRef.current.stopAndUnloadAsync(); } catch {} recordingRef.current = null; }
    } else {
      voiceModeRef.current = true;
      setVoiceMode(true); setVoiceStatus("listening");
      await startRecordingForVoiceMode();
    }
  };

  const startNativeSilenceDetection = () => {
    silenceMsRef.current = 0; hasSpeechRef.current = false;
    let nativeBaseline = -60; let nativeFrames = 0;
    silenceCheckRef.current = setInterval(async () => {
      if (!voiceModeRef.current || !recordingRef.current) { clearInterval(silenceCheckRef.current); return; }
      try {
        const status = await recordingRef.current.getStatusAsync();
        const db = status.metering ?? -160;
        if (nativeFrames < 5) { nativeBaseline = (nativeBaseline * nativeFrames + db) / (nativeFrames + 1); nativeFrames++; return; }
        const isSpeech = db > nativeBaseline + 8;
        if (isSpeech) { hasSpeechRef.current = true; silenceMsRef.current = 0; setSilenceCountdown(null); }
        else {
          if (!hasSpeechRef.current) return;
          silenceMsRef.current += SILENCE_CHECK_INTERVAL;
          if (silenceMsRef.current >= SILENCE_DURATION_MS - 1000) setSilenceCountdown(Math.ceil((SILENCE_DURATION_MS - silenceMsRef.current) / 1000));
          if (silenceMsRef.current >= SILENCE_DURATION_MS) { clearInterval(silenceCheckRef.current); silenceCheckRef.current = null; setSilenceCountdown(null); stopRecordingForVoiceMode(); }
        }
      } catch {}
    }, SILENCE_CHECK_INTERVAL);
  };

  const startRecordingForVoiceMode = async () => {
    if (!voiceModeRef.current) return;
    clearSilenceDetection(); setIsRecording(true);
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus("idle"); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
      recordingRef.current = recording;
      setTimeout(() => { if (voiceModeRef.current) startNativeSilenceDetection(); }, MIC_WARMUP_MS);
    } catch (e) { console.error("[VoiceMode]", e); voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus("idle"); }
  };

  const stopRecordingForVoiceMode = async () => {
    if (!voiceModeRef.current) return;
    clearSilenceDetection(); setIsRecording(false); setVoiceStatus("thinking");
    try {
      if (!recordingRef.current) return;
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI(); recordingRef.current = null;
      if (!uri) { if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); } return; }
      await new Promise(r => setTimeout(r, 500));
      const fd = new FormData(); fd.append("file", { uri, name: "recording.m4a", type: "audio/m4a" });
      const tr = await fetch(`${BACKEND_URL}/transcribe/`, { method: "POST", body: fd });
      const td = await tr.json();
      const transcribedText = td.text?.trim() || "";
      if (!transcribedText || !voiceModeRef.current) { if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); } return; }
      setMessages(prev => [...prev, { id: Date.now(), text: transcribedText, sender: "user", jargon: {}, isScam: false, scamResult: null }]);
      
      const cr = await fetch(`${BACKEND_URL}/chat/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: transcribedText, language, simplify: true, history: historyRef.current, vision_context: visionContext }) });
      const cd = await cr.json();
      const reply = String(cd.reply || "");
      triggerScamSheet(cd.scam_alert, 400);
      const risk = cd.scam_alert?.risk_level;
      setMessages(prev => [...prev, { id: Date.now() + 1, text: reply, sender: "bot", jargon: cd.jargon || {}, scamResult: cd.scam_alert || null, isScam: risk === "HIGH" || risk === "MEDIUM" }]);
      historyRef.current = [...historyRef.current, { role: "user", content: transcribedText }, { role: "assistant", content: reply }].slice(-6);
      if (voiceModeRef.current) speakAndLoop(reply);
    } catch (e) { console.error("[VoiceMode]", e); if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); } }
  };

  const speakAndLoop = (text) => {
    const clean = String(text || "")
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/gu, '')
      .replace(/[•·●◆✦✅🔴🟡🟢]/gu, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '').replace(/\s+/g, ' ').trim();
    setVoiceStatus("speaking"); Speech.stop();
    Speech.speak(clean, {
      language: uiLangMap[language] || "en-US", rate: 0.9,
      onDone: () => { if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); } }
    });
  };

  // ── Image & FAQ helpers (✅ PROACTIVE SUBSIDY INTEGRATED) ──────────────
  const pickImageAndAnalyze = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission Required", "We need access to your photos."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7 });
    if (result.canceled) return;
    const imageUri = result.assets[0].uri;
    setMessages(prev => [...prev, { id: Date.now(), text: "📷 Uploaded a document for analysis.", sender: "user", jargon: {}, isScam: false, scamResult: null }]);
    setIsLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", { uri: imageUri, name: "document.jpg", type: "image/jpeg" });
      fd.append("language", language); 
      const res = await fetch(`${BACKEND_URL}/vision/`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setVisionContext(data.explanation || ""); 
      triggerScamSheet(data.scam_result, 600);
      const isScam = ["HIGH", "MEDIUM"].includes(data.scam_result?.risk_level);

      let newMessages = [{
        id: Date.now() + 1, 
        text: String(data.explanation || "") + "\n\n💬 Ask me follow-up questions in any language!", 
        sender: "bot", jargon: data.jargon || {}, scamResult: data.scam_result || null, isScam
      }];

      // 🚨 NEW: The Proactive Subsidy Bubble!
      if (data.suggested_subsidy) {
        newMessages.push({
          id: Date.now() + 2,
          text: `💡 **Proactive Tip!**\nBased on your document, you might qualify for **${data.suggested_subsidy}**.\n\n${data.subsidy_reason}\n\nType "Help me apply for ${data.suggested_subsidy}" to get started!`,
          sender: "bot", jargon: {}, isScam: false, scamResult: null
        });
      }

      setMessages(prev => [...prev, ...newMessages]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, I couldn't process that image.", sender: "bot", jargon: {}, isScam: false, scamResult: null }]);
    } finally { setIsLoading(false); }
  };

  const handleFaqPress = (faq) => {
    setMessages(prev => [...prev,
      { id: Date.now(), text: faq.question, sender: "user", isScam: false, jargon: {} },
      { id: Date.now() + 1, text: "⚡ [OFFLINE CACHE]\n" + faq.answer, sender: "bot", isScam: false, jargon: {} },
    ]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sendMessage = async (textOverride) => {
    const text = textOverride || inputText;
    if (!text || !text.trim()) return;
    setMessages(prev => [...prev, { id: Date.now(), text: String(text), sender: "user", jargon: {}, isScam: false, scamResult: null }]);
    setInputText(""); setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chat/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, language, simplify: true, history: historyRef.current, vision_context: visionContext }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      triggerScamSheet(data.scam_alert, 400);
      const isScam = ["HIGH", "MEDIUM"].includes(data.scam_alert?.risk_level);
      setMessages(prev => [...prev, { id: Date.now() + 1, text: String(data.reply || ""), sender: "bot", jargon: data.jargon || {}, scamResult: data.scam_alert || null, isScam }]);
      historyRef.current = [...historyRef.current, { role: "user", content: String(text) }, { role: "assistant", content: String(data.reply || "") }].slice(-6);
    } catch {
      setMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, I couldn't reach the server.", sender: "bot", jargon: {}, isScam: false, scamResult: null }]);
    } finally { setIsLoading(false); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ELIGIBILITY SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'eligibility') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <StatusBar style="light" />
        <View style={[styles.formHeader, { backgroundColor: '#2e7d32' }]}>
          <TouchableOpacity onPress={() => setScreen('chat')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.formHeaderCenter}>
            <Text style={styles.formHeaderTitle}>✅ Eligibility Check</Text>
          </View>
          <View style={styles.formLangRow}>
            {LANGUAGES.map(l => (
              <TouchableOpacity key={l.code} style={[styles.formLangBtn, eligLanguage === l.code && styles.formLangBtnActive]}
                onPress={() => startEligibilityChecker(l.code)}>
                <Text style={[styles.formLangBtnText, eligLanguage === l.code && styles.formLangBtnTextActive]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.min((eligStep / 5) * 100, 100)}%`, backgroundColor: '#2e7d32' }]} />
        </View>
        <Text style={styles.progressText}>
          {eligComplete ? (eligResult?.eligible ? "✅ You qualify!" : "❌ Does not qualify")
            : eligStep === 0 ? "Select programme" : `Question ${eligStep} of 5`}
        </Text>
        <ScrollView style={styles.chatArea} ref={eligScrollRef} contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
          onContentSizeChange={() => eligScrollRef.current?.scrollToEnd({ animated: true })}>
          {eligMessages.map((msg, i) => (
            <View key={msg.id || i} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
              <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble,
                msg.resultType === 'eligible' && eligStyles.eligibleBubble,
                msg.resultType === 'not_eligible' && eligStyles.notEligibleBubble]}>
                <Text style={[styles.messageText,
                  msg.resultType === 'eligible' && eligStyles.eligibleText,
                  msg.resultType === 'not_eligible' && eligStyles.notEligibleText]} selectable>
                  {String(msg.text || "")}
                </Text>
              </View>
            </View>
          ))}
          {eligLoading && <View style={styles.loadingContainer}><ActivityIndicator size="small" color="#2e7d32" /><Text style={styles.loadingText}>Checking...</Text></View>}
        </ScrollView>
        {eligComplete ? (
          <View style={styles.formCompleteBar}>
            {eligResult?.eligible ? (
              <>
                <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: '#2e7d32' }]} onPress={proceedToForm}>
                  <Text style={styles.downloadBtnText}>📝 Proceed to Fill Application Form</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.restartBtn} onPress={() => startEligibilityChecker(eligLanguage)}>
                  <Text style={styles.restartBtnText}>Check Again</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: '#757575' }]} onPress={() => setScreen('chat')}>
                  <Text style={styles.downloadBtnText}>← Back to Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.restartBtn} onPress={() => startEligibilityChecker(eligLanguage)}>
                  <Text style={styles.restartBtnText}>Try Again</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput style={[styles.textInput, { flex: 1 }]} placeholder="Type your answer..." value={eligInput}
              onChangeText={setEligInput} onSubmitEditing={sendEligibilityAnswer} returnKeyType="send" multiline />
            <TouchableOpacity style={[styles.sendButton, { backgroundColor: '#2e7d32' }]} onPress={sendEligibilityAnswer} disabled={eligLoading}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FORM SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'form') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <StatusBar style="light" />
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={() => setScreen('eligibility')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.formHeaderCenter}>
            <Text style={styles.formHeaderTitle}>📝 Borang STR</Text>
            <Text style={styles.formHeaderSub}>Sumbangan Tunai Rahmah</Text>
          </View>
          <View style={styles.formLangRow}>
            {LANGUAGES.map(l => (
              <TouchableOpacity key={l.code} style={[styles.formLangBtn, formLanguage === l.code && styles.formLangBtnActive]}
                onPress={() => setFormLanguage(l.code)}>
                <Text style={[styles.formLangBtnText, formLanguage === l.code && styles.formLangBtnTextActive]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.min((formField / 6) * 100, 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>{formComplete ? "Complete!" : `Question ${formField + 1} of 6`}</Text>
        <ScrollView style={styles.chatArea} ref={formScrollRef} contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
          onContentSizeChange={() => formScrollRef.current?.scrollToEnd({ animated: true })}>
          {formMessages.map((msg, i) => (
            <View key={msg.id || i} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
              <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble, msg.isComplete && styles.completeBubble]}>
                <Text style={[styles.messageText, msg.isComplete && styles.completeText]} selectable>{String(msg.text || "")}</Text>
              </View>
            </View>
          ))}
          {formLoading && <View style={styles.loadingContainer}><ActivityIndicator size="small" color="#1565c0" /><Text style={styles.loadingText}>Processing...</Text></View>}
        </ScrollView>
        {formComplete ? (
          <View style={styles.formCompleteBar}>
            <TouchableOpacity style={[styles.downloadBtn, generatingPDF && styles.downloadBtnDisabled]} onPress={downloadPDF} disabled={generatingPDF}>
              {generatingPDF ? <ActivityIndicator color="white" /> : <Text style={styles.downloadBtnText}>⬇️ Download Filled PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.restartBtn} onPress={startFormFiller}>
              <Text style={styles.restartBtnText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput style={[styles.textInput, { flex: 1 }]} placeholder="Type your answer..." value={formInput}
              onChangeText={setFormInput} onSubmitEditing={sendFormAnswer} returnKeyType="send" multiline />
            <TouchableOpacity style={styles.sendButton} onPress={sendFormAnswer} disabled={formLoading}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE MODE OVERLAY
  // ══════════════════════════════════════════════════════════════════════════
  if (voiceMode) {
    const cfg = {
      listening: { emoji: "🎤", label: "Listening...\nSpeak now", color: "#e53935" },
      thinking:  { emoji: "🧠", label: "Thinking...",             color: "#1565c0" },
      speaking:  { emoji: "🔊", label: "Speaking...",             color: "#128c7e" },
      idle:      { emoji: "🎤", label: "Ready",                   color: "#333"    },
    }[voiceStatus] || { emoji: "🎤", label: "Ready", color: "#333" };
    return (
      <View style={voiceStyles.overlay}>
        <StatusBar style="light" />
        <ScrollView style={voiceStyles.chatBg} contentContainerStyle={{ flexGrow: 1, paddingBottom: 320 }}
          ref={scrollViewRef} onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
          {messages.map((msg, i) => (
            <View key={msg.id || i} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
              <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble]}>
                <Text style={styles.messageText} selectable>{String(msg.text || "")}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={voiceStyles.panel}>
          <Text style={voiceStyles.statusEmoji}>{cfg.emoji}</Text>
          <Text style={[voiceStyles.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
          {voiceStatus === 'listening' && silenceCountdown !== null && (
            <View style={voiceStyles.countdownBox}>
              <View style={[voiceStyles.countdownFill, { width: `${(silenceCountdown / 2.5) * 100}%` }]} />
              <Text style={voiceStyles.countdownText}>Sending in {silenceCountdown}s…</Text>
            </View>
          )}
          {voiceStatus === 'listening' && (
            <TouchableOpacity style={voiceStyles.stopBtn} onPress={stopRecordingForVoiceMode}>
              <Text style={voiceStyles.stopBtnText}>⏹ Done speaking</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={voiceStyles.exitBtn} onPress={toggleVoiceMode}>
            <Text style={voiceStyles.exitBtnText}>✕ Exit Voice Mode</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN CHAT SCREEN (✅ WHATSAPP UI INTEGRATED)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
      <StatusBar style="light" />

      {/* ── WHATSAPP STYLE HEADER ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
          <Text style={styles.headerSubtitle}>Ask in any language • Scam protected</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
          <TouchableOpacity style={styles.sosButton} onPress={() => setSosSheet(true)}>
            <Text style={styles.sosButtonText}>🚨 SOS</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDocs(true)}>
            <Ionicons name="folder-open" size={24} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearChat}>
            <Ionicons name="trash-outline" size={26} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.applyBanner} onPress={() => startEligibilityChecker("en")}>
        <Text style={styles.applyBannerEmoji}>📝</Text>
        <View>
          <Text style={styles.applyBannerTitle}>Help me apply</Text>
          <Text style={styles.applyBannerSub}>Check eligibility → Fill form → Download PDF</Text>
        </View>
        <Text style={styles.applyBannerArrow}>›</Text>
      </TouchableOpacity>

      {visionContext != null && (
        <View style={styles.contextBanner}>
          <Text style={styles.contextBannerText}>📄 Document loaded — ask follow-up questions!</Text>
          <TouchableOpacity onPress={() => setVisionContext(null)}>
            <Text style={styles.contextBannerClear}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.chatArea} contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
        ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
        {messages.map((msg, index) => (
          <View key={msg.id || index} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
            <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble, msg.isScam && styles.scamBubble]}>
              {msg.isScam && msg.scamResult && (
                <View style={styles.scamAlertHeader}>
                  <Text style={styles.scamAlertHeaderText}>{scamRiskEmoji(msg.scamResult.risk_level)} Scam Alert — {String(msg.scamResult.risk_level || "")}</Text>
                </View>
              )}
              {renderMessageWithJargon(msg.text, msg.jargon, msg.isScam)}
              {msg.scamResult && msg.scamResult.risk_level !== "SAFE" && (
                <TouchableOpacity style={[styles.scamDetailBtn, { borderColor: scamRiskColor(msg.scamResult.risk_level) }]}
                  onPress={() => setScamSheet({ visible: true, data: msg.scamResult })}>
                  <Text style={[styles.scamDetailBtnText, { color: scamRiskColor(msg.scamResult.risk_level) }]}>View Scam Report →</Text>
                </TouchableOpacity>
              )}
              {msg.sender === 'bot' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <TouchableOpacity onPress={() => speakMessage(msg.text)} style={styles.speakBtn}>
                    <Text style={styles.speakBtnText}>🔊 Read aloud</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={stopSpeaking} style={styles.speakBtn}>
                    <Text style={styles.speakBtnText}>⏹ Stop</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ))}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#128c7e" />
            <Text style={styles.loadingText}>{isRecording ? "Recording... tap mic to stop" : "Thinking..."}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── BOTTOM CONTROLS WRAPPER (✅ DISCLAIMER FIX INTEGRATED) ── */}
      <View style={styles.bottomControlsWrapper}>
        
        {/* 1. WhatsApp Style Input Row */}
        <View style={styles.whatsappInputRow}>
          <View style={styles.whatsappTextInputWrapper}>
            <TextInput
              style={styles.whatsappTextInput}
              placeholder={isRecording ? "Recording..." : visionContext ? "Ask about document..." : "Message"}
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              multiline
              editable={!isRecording}
            />
            <TouchableOpacity style={styles.whatsappCameraBtn} onPress={pickImageAndAnalyze}>
              <Ionicons name="camera" size={24} color="#888" />
            </TouchableOpacity>
          </View>

          {inputText.trim() ? (
            <TouchableOpacity style={styles.whatsappCircleBtn} onPress={() => sendMessage()} disabled={isLoading}>
              <Ionicons name="send" size={20} color="white" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.whatsappCircleBtn, isRecording && { backgroundColor: '#e53935' }]}
              onPress={handleMicPress}
              disabled={isLoading && !isRecording}>
              <Ionicons name={isRecording ? "stop" : "mic"} size={24} color="white" />
            </TouchableOpacity>
          )}
        </View>

        {/* 2. Voice Mode Button */}
        <TouchableOpacity style={voiceStyles.voiceModeBtn} onPress={toggleVoiceMode}>
          <Text style={voiceStyles.voiceModeBtnText}>🎙️ Voice Mode — Tap to talk hands-free</Text>
        </TouchableOpacity>

        {/* 3. The Disclaimer */}
        <Text style={styles.disclaimerText}>
          AI can make mistakes. Please verify important information.
        </Text>
        
      </View>

      <DocumentsDrawer visible={showDocs} backendUrl={BACKEND_URL} onClose={() => setShowDocs(false)} />

      {/* SOS Modal */}
      <Modal visible={sosSheet} transparent animationType="slide" onRequestClose={() => setSosSheet(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSosSheet(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.scamSheetTitle}>🚨 Emergency Offline Help</Text>
            <Text style={styles.scamVerdict}>Tap an issue below for immediate offline instructions:</Text>
            <ScrollView style={{ maxHeight: 450, marginBottom: 15 }}>
              {EMERGENCY_FAQS.map(faq => (
                <View key={faq.id} style={styles.sosListItem}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSosSheet(false); handleFaqPress(faq); }}>
                    <Text style={styles.sosListTitle}>{faq.shortTitle}</Text>
                    <Text style={styles.sosListPreview}>{faq.question}</Text>
                  </TouchableOpacity>
                  {faq.phone && (
                    <TouchableOpacity style={styles.sosCallBtn} onPress={() => Linking.openURL(`tel:${faq.phone}`)}>
                      <Text style={styles.sosCallBtnText}>📞 {faq.phone}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setSosSheet(false)}>
              <Text style={styles.sheetCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Jargon Sheet */}
      <Modal visible={jargonSheet.visible} transparent animationType="slide" onRequestClose={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.jargonLabel}>📖 Jargon Buster</Text>
            <Text style={styles.jargonTerm}>{String(jargonSheet.term || "")}</Text>
            <Text style={styles.jargonExplanation}>{String(jargonSheet.explanation || "")}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
              <Text style={styles.sheetCloseBtnText}>Got it ✓</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Scam Sheet */}
      <Modal visible={scamSheet.visible} transparent animationType="slide" onRequestClose={() => setScamSheet({ visible: false, data: null })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setScamSheet({ visible: false, data: null })}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            {scamSheet.data && (() => {
              const d = scamSheet.data; const level = String(d.risk_level || d.risk || "UNKNOWN");
              const color = scamRiskColor(level); const emoji = scamRiskEmoji(level);
              return (<>
                <Text style={styles.scamSheetTitle}>🛡️ Scam Shield Report</Text>
                <View style={[styles.scamRiskBanner, { backgroundColor: color }]}><Text style={styles.scamRiskBannerText}>{emoji} Risk Level: {level}</Text></View>
                <Text style={styles.scamVerdict}>{String(d.verdict || d.warning || "")}</Text>
                {Array.isArray(d.red_flags) && d.red_flags.length > 0 && (
                  <View style={styles.scamSection}>
                    <Text style={styles.scamSectionTitle}>🚩 Red Flags Detected</Text>
                    {d.red_flags.map((f, i) => <Text key={i} style={styles.scamRedFlag}>• {String(f || "")}</Text>)}
                  </View>
                )}
                {level === "HIGH" && (
                  <View style={styles.scamWarningBox}>
                    <Text style={styles.scamWarningText}>⚠️ Do NOT provide personal info or click any links.{'\n'}Report scams: CyberSecurity Malaysia 1-300-88-2999</Text>
                  </View>
                )}
                <TouchableOpacity style={[styles.sheetCloseBtn, { backgroundColor: color }]} onPress={() => setScamSheet({ visible: false, data: null })}>
                  <Text style={styles.sheetCloseBtnText}>Close</Text>
                </TouchableOpacity>
              </>);
            })()}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}
