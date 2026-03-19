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
import { EMERGENCY_FAQS } from './faqs';
import { styles } from './styles';

let FileSystem = null;
let Sharing = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
  Sharing    = require('expo-sharing');
}

export default function App() {
  const BACKEND_URL = 'http://192.168.0.7:8000';

  const [screen, setScreen] = useState('chat');

  const initialMessage = {
    id: 1,
    text: "Welcome to SilaSpeak! 🇲🇾\nAsk me anything about Malaysian government services in ANY language.\n\nTap 📷 to snap a photo, or tap 📝 Help me apply to fill a government form!\n\nTip: Underlined words are jargon — tap them for a quick explanation!",
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

  // ── Voice Mode ────────────────────────────────────────────────────────────
  const [voiceMode,   setVoiceMode]   = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | listening | thinking | speaking
  const voiceModeRef = useRef(false);

  const [formMessages,  setFormMessages]  = useState([]);
  const [formInput,     setFormInput]     = useState("");
  const [formLoading,   setFormLoading]   = useState(false);
  const [formField,     setFormField]     = useState(0);
  const [formCollected, setFormCollected] = useState({});
  const [formComplete,  setFormComplete]  = useState(false);
  const [formLanguage,  setFormLanguage]  = useState("en");
  const [generatingPDF, setGeneratingPDF] = useState(false);

  const scrollViewRef    = useRef();
  const formScrollRef    = useRef();
  const recordingRef     = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const historyRef       = useRef([]);

  const LANGUAGES = [
    { code: "en", label: "EN" },
    { code: "ms", label: "MS" },
    { code: "zh", label: "中文" },
    { code: "ta", label: "தமிழ்" },
  ];

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  // ── TTS locale helper ─────────────────────────────────────────────────────
  // Maps detected language name (from backend) to TTS locale code
  const getLocaleFromLangName = (langName) => {
    if (!langName) return null;
    const map = {
      "english":    "en-US",
      "malay":      "ms-MY",
      "bahasa":     "ms-MY",
      "chinese":    "zh-CN",
      "mandarin":   "zh-CN",
      "tamil":      "ta-IN",
      "indonesian": "id-ID",
      "arabic":     "ar",
      "japanese":   "ja-JP",
      "korean":     "ko-KR",
    };
    return map[langName.toLowerCase()] || null;
  };

  const uiLangMap = { en:"en-US", ms:"ms-MY", zh:"zh-CN", ta:"ta-IN" };

  // ── Voice Mode toggle ─────────────────────────────────────────────────────
  const toggleVoiceMode = async () => {
    if (voiceMode) {
      voiceModeRef.current = false;
      setVoiceMode(false);
      setVoiceStatus("idle");
      setIsRecording(false);
      if (Platform.OS === 'web') window.speechSynthesis.cancel();
      else Speech.stop();
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
        recordingRef.current = null;
      }
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch {}
        mediaRecorderRef.current = null;
      }
      console.log("[VoiceMode] OFF");
    } else {
      voiceModeRef.current = true;
      setVoiceMode(true);
      setVoiceStatus("listening");
      console.log("[VoiceMode] ON");
      await startRecordingForVoiceMode();
    }
  };

  // ── Voice Mode: speak reply then auto-restart mic ─────────────────────────
  const speakAndLoop = (text, detectedLangName = null) => {
    const clean = String(text || "")
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/gu, '')
      .replace(/[•·●◆✦✅🔴🟡🟢]/gu, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
      .replace(/\s+/g, ' ').trim();

    // Use detected language name from backend if available,
    // otherwise fall back to UI language selector
    const ttsLocale = getLocaleFromLangName(detectedLangName)
      || uiLangMap[language]
      || "en-US";

    console.log(`[VoiceMode] Speaking in locale: ${ttsLocale} (detected: ${detectedLangName})`);
    setVoiceStatus("speaking");

    const onDoneCallback = () => {
      if (voiceModeRef.current) {
        console.log("[VoiceMode] Done speaking, restarting mic...");
        setVoiceStatus("listening");
        startRecordingForVoiceMode();
      }
    };

    if (Platform.OS === 'web') {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = ttsLocale;
      u.rate = 0.9;
      u.onend = onDoneCallback;
      window.speechSynthesis.speak(u);
    } else {
      Speech.stop();
      Speech.speak(clean, {
        language: ttsLocale,
        rate: 0.9,
        onDone: onDoneCallback,
      });
    }
  };

  // ── Voice Mode: start mic ─────────────────────────────────────────────────
  const startRecordingForVoiceMode = async () => {
    if (!voiceModeRef.current) return;
    setIsRecording(true);

    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        mr.start();
        mediaRecorderRef.current = mr;
      } catch (e) {
        console.error("[VoiceMode] Mic error:", e);
        voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus("idle");
      }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) { voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus("idle"); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording;
      } catch (e) {
        console.error("[VoiceMode] Mic error:", e);
        voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus("idle");
      }
    }
  };

  // ── Voice Mode: stop mic, transcribe, get AI answer, speak ───────────────
  const stopRecordingForVoiceMode = async () => {
    if (!voiceModeRef.current) return;
    setIsRecording(false);
    setVoiceStatus("thinking");

    try {
      let transcribedText = "";

      if (Platform.OS === 'web') {
        if (!mediaRecorderRef.current) return;
        await new Promise(resolve => {
          mediaRecorderRef.current.onstop = resolve;
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        });
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size < 500) {
          if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); }
          return;
        }
        const fd = new FormData(); fd.append("file", blob, "recording.webm");
        const res = await fetch(`${BACKEND_URL}/transcribe/`, { method: "POST", body: fd });
        const data = await res.json();
        transcribedText = data.text?.trim() || "";
      } else {
        if (!recordingRef.current) return;
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (!uri) { if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); } return; }
        await new Promise(r => setTimeout(r, 500));
        const fd = new FormData(); fd.append("file", { uri, name: "recording.m4a", type: "audio/m4a" });
        const res = await fetch(`${BACKEND_URL}/transcribe/`, { method: "POST", headers: { "Content-Type": "multipart/form-data" }, body: fd });
        const data = await res.json();
        transcribedText = data.text?.trim() || "";
      }

      if (!transcribedText || !voiceModeRef.current) {
        if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); }
        return;
      }

      console.log("[VoiceMode] Transcribed:", transcribedText);

      // Show user message
      setMessages(prev => [...prev, {
        id: Date.now(), text: transcribedText, sender: "user",
        jargon: {}, isScam: false, scamResult: null,
      }]);

      // Get AI answer
      const res = await fetch(`${BACKEND_URL}/chat/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: transcribedText, language, simplify: true,
          history: historyRef.current, vision_context: visionContext,
        })
      });
      const aiData = await res.json();
      const reply = String(aiData.reply || "");

      // Show bot reply
      triggerScamSheet(aiData.scam_alert, 400);
      const risk = aiData.scam_alert?.risk_level;
      setMessages(prev => [...prev, {
        id: Date.now() + 1, text: reply, sender: "bot",
        jargon: aiData.jargon || {}, scamResult: aiData.scam_alert || null,
        isScam: risk === "HIGH" || risk === "MEDIUM",
      }]);
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: transcribedText },
        { role: "assistant", content: reply },
      ].slice(-6);

      // Speak using the backend-detected language name for correct TTS voice
      if (voiceModeRef.current) {
        speakAndLoop(reply, aiData.detected_language_name || null);
      }

    } catch (e) {
      console.error("[VoiceMode] Error:", e);
      if (voiceModeRef.current) { setVoiceStatus("listening"); startRecordingForVoiceMode(); }
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const clearChat = () => {
    setMessages([initialMessage]);
    historyRef.current = [];
    setVisionContext(null);
  };

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web') window.alert(`${title}: ${msg}`);
    else Alert.alert(title, msg);
  };

  const scamRiskColor = (level) => ({ HIGH:"#c62828",MEDIUM:"#e65100",LOW:"#f9a825",SAFE:"#2e7d32" }[level]||"#757575");
  const scamRiskEmoji = (level) => ({ HIGH:"🚨",MEDIUM:"⚠️",LOW:"🔍",SAFE:"✅" }[level]||"❓");

  const triggerScamSheet = (scamData, delay = 0) => {
    if (!scamData) return;
    const risk = scamData.risk_level || scamData.risk;
    if (risk && risk !== "SAFE" && risk !== "UNKNOWN")
      setTimeout(() => setScamSheet({ visible: true, data: scamData }), delay);
  };

  const renderMessageWithJargon = (text, jargon, isScam) => {
    const safeText   = text != null ? String(text) : "";
    const safeJargon = jargon && typeof jargon === 'object' ? jargon : {};
    const baseStyle  = [styles.messageText, isScam && styles.scamMessageText];
    const terms      = Object.keys(safeJargon);
    if (terms.length === 0) return <Text style={baseStyle} selectable>{safeText}</Text>;
    try {
      const pattern = new RegExp(`(${terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`, 'gi');
      const parts = safeText.split(pattern);
      return (
        <Text style={baseStyle} selectable>
          {parts.map((part, i) => {
            if (!part) return null;
            const match = terms.find(t => t.toLowerCase() === part.toLowerCase());
            if (match) return (
              <Text key={i} style={styles.jargonUnderline}
                onPress={() => setJargonSheet({ visible:true, term:String(match), explanation:String(safeJargon[match]||"") })}>
                {String(part)}
              </Text>
            );
            return <Text key={i}>{String(part)}</Text>;
          })}
        </Text>
      );
    } catch { return <Text style={baseStyle} selectable>{safeText}</Text>; }
  };

  // ── Manual TTS ────────────────────────────────────────────────────────────
  const speakMessage = (text) => {
    const clean = String(text||"")
      .replace(/[\u{1F000}-\u{1FFFF}]/gu,'').replace(/[\u2600-\u27BF]/gu,'')
      .replace(/[•·●◆✦✅🔴🟡🟢]/gu,'').replace(/\*/g,'').replace(/#{1,6}\s/g,'')
      .replace(/\s+/g,' ').trim();
    const ttsLang = uiLangMap[language] || "en-US";
    if (Platform.OS === 'web') {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = ttsLang; u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } else {
      Speech.stop();
      Speech.speak(clean, { language: ttsLang, rate: 0.9 });
    }
  };

  const stopSpeaking = () => {
    if (Platform.OS === 'web') window.speechSynthesis.cancel();
    else Speech.stop();
  };

  // ── Image Analysis ────────────────────────────────────────────────────────
  const pickImageAndAnalyze = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        setMessages(prev=>[...prev,{id:Date.now(),text:"Uploaded a document for analysis.",sender:"user",jargon:{},isScam:false,scamResult:null}]);
        setIsLoading(true);
        try {
          const fd = new FormData(); fd.append("file",file); fd.append("language",language);
          const res = await fetch(`${BACKEND_URL}/vision/`,{method:'POST',body:fd});
          if (!res.ok) throw new Error();
          const data = await res.json();
          setVisionContext(data.explanation||"");
          triggerScamSheet(data.scam_result,600);
          const risk = data.scam_result?.risk_level;
          setMessages(prev=>[...prev,{id:Date.now()+1,text:String(data.explanation||"")+"\n\nYou can now ask follow-up questions!",sender:"bot",jargon:data.jargon||{},scamResult:data.scam_result||null,isScam:risk==="HIGH"||risk==="MEDIUM"}]);
        } catch { setMessages(prev=>[...prev,{id:Date.now()+1,text:"Sorry, couldn't process the image.",sender:"bot",jargon:{},isScam:false,scamResult:null}]); }
        finally { setIsLoading(false); }
      };
      input.click(); return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert("Permission Required","We need access to your photos."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,quality:0.7});
    if (result.canceled) return;
    const imageUri = result.assets[0].uri;
    setMessages(prev=>[...prev,{id:Date.now(),text:"📷 Uploaded a document for analysis.",sender:"user",jargon:{},isScam:false,scamResult:null}]);
    setIsLoading(true);
    try {
      const fd = new FormData(); fd.append("file",{uri:imageUri,name:"document.jpg",type:"image/jpeg"}); fd.append("language",language);
      const res = await fetch(`${BACKEND_URL}/vision/`,{method:'POST',body:fd});
      if (!res.ok) throw new Error();
      const data = await res.json();
      setVisionContext(data.explanation||"");
      triggerScamSheet(data.scam_result,600);
      const risk = data.scam_result?.risk_level;
      setMessages(prev=>[...prev,{id:Date.now()+1,text:String(data.explanation||"")+"\n\nAsk me follow-up questions!",sender:"bot",jargon:data.jargon||{},scamResult:data.scam_result||null,isScam:risk==="HIGH"||risk==="MEDIUM"}]);
    } catch { setMessages(prev=>[...prev,{id:Date.now()+1,text:"Sorry, couldn't process the image.",sender:"bot",jargon:{},isScam:false,scamResult:null}]); }
    finally { setIsLoading(false); }
  };

  // ── Normal mic (tap-toggle) ───────────────────────────────────────────────
  const handleMicPress = async () => {
    if (isRecording) await stopRecording();
    else await startRecording();
  };

  const startRecording = async () => {
    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        mr.start(); mediaRecorderRef.current = mr; setIsRecording(true);
      } catch { showAlert("Mic Error","Allow microphone permission in your browser."); }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) { showAlert("Permission","Microphone access required."); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording; setIsRecording(true);
      } catch { showAlert("Error","Failed to start recording."); }
    }
  };

  const stopRecording = async () => {
    setIsRecording(false); setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        await new Promise(resolve => {
          mediaRecorderRef.current.onstop = resolve;
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        });
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size < 500) { showAlert("Too Short","Speak for at least 2 seconds."); setIsLoading(false); return; }
        const fd = new FormData(); fd.append("file", blob, "recording.webm");
        const res = await fetch(`${BACKEND_URL}/transcribe/`, { method:"POST", body:fd });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.text?.trim()) setInputText(data.text.trim());
        else showAlert("No Speech","Could not detect speech. Try again.");
      } else {
        if (!recordingRef.current) return;
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI(); recordingRef.current = null;
        if (!uri) { showAlert("Error","No audio captured."); return; }
        await new Promise(r => setTimeout(r, 800));
        if (FileSystem) {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists || info.size < 500) { showAlert("Too Short","Speak for at least 2 seconds."); return; }
        }
        const fd = new FormData(); fd.append("file",{uri,name:"recording.m4a",type:"audio/m4a"});
        const res = await fetch(`${BACKEND_URL}/transcribe/`, { method:"POST", headers:{"Content-Type":"multipart/form-data"}, body:fd });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.text?.trim()) setInputText(data.text.trim());
        else showAlert("No Speech","Could not detect speech. Try again.");
      }
    } catch (e) { showAlert("Voice Error", e.message||"Could not transcribe."); }
    finally { setIsLoading(false); }
  };

  // ── Offline FAQ ───────────────────────────────────────────────────────────
  const handleFaqPress = (faq) => {
    setMessages(prev => [...prev,
      { id:Date.now(),   text:faq.question, sender:"user", isScam:false, jargon:{} },
      { id:Date.now()+1, text:"⚡ [OFFLINE CACHE]\n"+faq.answer, sender:"bot", isScam:false, jargon:{} },
    ]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // ── Send Message ──────────────────────────────────────────────────────────
  const sendMessage = async (textOverride) => {
    const text = textOverride || inputText;
    if (!text?.trim()) return;
    setMessages(prev=>[...prev,{id:Date.now(),text:String(text),sender:"user",jargon:{},isScam:false,scamResult:null}]);
    setInputText(""); setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chat/`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:text, language, simplify:true, history:historyRef.current, vision_context:visionContext })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      triggerScamSheet(data.scam_alert, 400);
      const risk = data.scam_alert?.risk_level;
      setMessages(prev=>[...prev,{id:Date.now()+1,text:String(data.reply||""),sender:"bot",jargon:data.jargon||{},scamResult:data.scam_alert||null,isScam:risk==="HIGH"||risk==="MEDIUM"}]);
      historyRef.current = [...historyRef.current,{role:"user",content:String(text)},{role:"assistant",content:String(data.reply||"")}].slice(-6);
    } catch {
      setMessages(prev=>[...prev,{id:Date.now()+1,text:"Sorry, couldn't reach the server. Make sure the backend is running!",sender:"bot",jargon:{},isScam:false,scamResult:null}]);
    } finally { setIsLoading(false); }
  };

  // ── Form Filler ───────────────────────────────────────────────────────────
  const startFormFiller = async () => {
    setScreen('form'); setFormMessages([]); setFormField(0); setFormCollected({}); setFormComplete(false); setFormLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/form/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_answer:null,current_field:0,collected:{},language:formLanguage})});
      const data = await res.json();
      setFormMessages([{id:Date.now(),text:"📝 Let's fill in your Borang STR together!\nI'll ask you questions one at a time.\n\n"+(data.question||""),sender:"bot"}]);
      setFormField(data.current_field);
    } catch { Alert.alert("Error","Could not connect to server."); setScreen('chat'); }
    finally { setFormLoading(false); }
  };

  const sendFormAnswer = async () => {
    const answer = formInput.trim(); if (!answer) return;
    setFormMessages(prev=>[...prev,{id:Date.now(),text:answer,sender:"user"}]); setFormInput(""); setFormLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/form/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_answer:answer,current_field:formField,collected:formCollected,language:formLanguage})});
      const data = await res.json();
      setFormField(data.current_field); setFormCollected(data.collected||{}); setFormComplete(data.is_complete||false);
      setFormMessages(prev=>[...prev,{id:Date.now()+1,text:data.question||"",sender:"bot",isComplete:data.is_complete}]);
    } catch { setFormMessages(prev=>[...prev,{id:Date.now()+1,text:"Sorry, something went wrong.",sender:"bot"}]); }
    finally { setFormLoading(false); }
  };

  const downloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      const params = [
        `nama_penuh=${encodeURIComponent(formCollected.nama_penuh||'')}`,
        `no_mykad=${encodeURIComponent(formCollected.no_mykad||'')}`,
        `no_telefon=${encodeURIComponent(formCollected.no_telefon||'')}`,
        `emel=${encodeURIComponent(formCollected.emel||'')}`,
        `pendapatan_bulanan=${encodeURIComponent(formCollected.pendapatan_bulanan||'')}`,
        `status_perkahwinan=${encodeURIComponent(formCollected.status_perkahwinan||'')}`,
        `language=${encodeURIComponent(formLanguage)}`,
      ].join('&');
      const url = `${BACKEND_URL}/form/generate-get?${params}`;
      if (Platform.OS === 'web') { window.open(url,'_blank'); return; }
      const tempPath = FileSystem.cacheDirectory + 'Borang_STR_SilaSpeak.pdf';
      const dl = await FileSystem.downloadAsync(url, tempPath);
      if (dl.status !== 200) throw new Error(`Download failed: ${dl.status}`);
      if (Sharing) await Sharing.shareAsync(dl.uri,{mimeType:'application/pdf',dialogTitle:'Save your STR Form',UTI:'com.adobe.pdf'});
    } catch (e) { Alert.alert("Error","Could not generate PDF."); }
    finally { setGeneratingPDF(false); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORM SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'form') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?0:20}>
        <StatusBar style="light" />
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={() => setScreen('chat')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.formHeaderCenter}>
            <Text style={styles.formHeaderTitle}>📝 Borang STR</Text>
            <Text style={styles.formHeaderSub}>Sumbangan Tunai Rahmah</Text>
          </View>
          <View style={styles.formLangRow}>
            {LANGUAGES.map(l => (
              <TouchableOpacity key={l.code} style={[styles.formLangBtn, formLanguage===l.code&&styles.formLangBtnActive]} onPress={() => setFormLanguage(l.code)}>
                <Text style={[styles.formLangBtnText, formLanguage===l.code&&styles.formLangBtnTextActive]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width:`${Math.min((formField/6)*100,100)}%` }]} />
        </View>
        <Text style={styles.progressText}>{formComplete?"✅ Complete!":`Question ${Math.min(formField+1,6)} of 6`}</Text>
        <ScrollView style={styles.chatArea} ref={formScrollRef} contentContainerStyle={{flexGrow:1,paddingBottom:10}}
          onContentSizeChange={() => formScrollRef.current?.scrollToEnd({animated:true})}>
          {formMessages.map((msg,i) => (
            <View key={msg.id||i} style={[styles.messageRow, msg.sender==='user'?styles.userRow:styles.botRow]}>
              <View style={[styles.bubble, msg.sender==='user'?styles.userBubble:styles.botBubble, msg.isComplete&&styles.completeBubble]}>
                <Text style={[styles.messageText, msg.isComplete&&styles.completeText]} selectable>{String(msg.text||"")}</Text>
              </View>
            </View>
          ))}
          {formLoading && <View style={styles.loadingContainer}><ActivityIndicator size="small" color="#1565c0" /><Text style={styles.loadingText}>Processing...</Text></View>}
        </ScrollView>
        {formComplete ? (
          <View style={styles.formCompleteBar}>
            <TouchableOpacity style={[styles.downloadBtn, generatingPDF&&styles.downloadBtnDisabled]} onPress={downloadPDF} disabled={generatingPDF}>
              {generatingPDF ? <ActivityIndicator color="white" /> : <Text style={styles.downloadBtnText}>⬇️ Download Filled PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.restartBtn} onPress={startFormFiller}>
              <Text style={styles.restartBtnText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput style={[styles.textInput,{flex:1}]} placeholder="Type your answer..." value={formInput} onChangeText={setFormInput} onSubmitEditing={sendFormAnswer} returnKeyType="send" multiline />
            <TouchableOpacity style={styles.sendButton} onPress={sendFormAnswer} disabled={formLoading}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE MODE OVERLAY SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (voiceMode) {
    const statusConfig = {
      listening: { emoji: "🎤", label: "Listening...\nSpeak now", color: "#e53935" },
      thinking:  { emoji: "🧠", label: "Thinking...", color: "#1565c0" },
      speaking:  { emoji: "🔊", label: "Speaking...", color: "#128c7e" },
      idle:      { emoji: "🎤", label: "Ready", color: "#333" },
    };
    const cfg = statusConfig[voiceStatus] || statusConfig.idle;

    return (
      <View style={voiceStyles.overlay}>
        <StatusBar style="light" />
        <ScrollView style={voiceStyles.chatBg} contentContainerStyle={{flexGrow:1,paddingBottom:220}} ref={scrollViewRef}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({animated:true})}>
          {messages.map((msg, index) => (
            <View key={msg.id||index} style={[styles.messageRow, msg.sender==='user'?styles.userRow:styles.botRow]}>
              <View style={[styles.bubble, msg.sender==='user'?styles.userBubble:styles.botBubble]}>
                <Text style={styles.messageText} selectable>{String(msg.text||"")}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={voiceStyles.panel}>
          <Text style={voiceStyles.statusEmoji}>{cfg.emoji}</Text>
          <Text style={[voiceStyles.statusLabel, {color: cfg.color}]}>{cfg.label}</Text>
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
  // MAIN CHAT SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?0:20}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
          <Text style={styles.headerSubtitle}>Ask in any language • Scam protected</Text>
        </View>
        <View style={{ flexDirection:'row', gap:10 }}>
          <TouchableOpacity style={styles.sosButton} onPress={() => setSosSheet(true)}>
            <Text style={styles.sosButtonText}>🚨 SOS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.langBar}>
        <Text style={styles.langLabel}>Reply in:</Text>
        {LANGUAGES.map(l => (
          <TouchableOpacity key={l.code} style={[styles.langBtn, language===l.code&&styles.langBtnActive]} onPress={() => setLanguage(l.code)}>
            <Text style={[styles.langBtnText, language===l.code&&styles.langBtnTextActive]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.applyBanner} onPress={startFormFiller}>
        <Text style={styles.applyBannerEmoji}>📝</Text>
        <View><Text style={styles.applyBannerTitle}>Help me apply for STR</Text><Text style={styles.applyBannerSub}>Fill Borang STR with AI — get a ready-to-print PDF</Text></View>
        <Text style={styles.applyBannerArrow}>›</Text>
      </TouchableOpacity>

      {visionContext != null && (
        <View style={styles.contextBanner}>
          <Text style={styles.contextBannerText}>📄 Document loaded — ask follow-up questions!</Text>
          <TouchableOpacity onPress={() => setVisionContext(null)}><Text style={styles.contextBannerClear}>✕</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.chatArea} contentContainerStyle={{flexGrow:1,paddingBottom:10}} ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({animated:true})}
        onLayout={() => scrollViewRef.current?.scrollToEnd({animated:true})}>
        {messages.map((msg, index) => (
          <View key={msg.id||index} style={[styles.messageRow, msg.sender==='user'?styles.userRow:styles.botRow]}>
            <View style={[styles.bubble, msg.sender==='user'?styles.userBubble:styles.botBubble, msg.isScam&&styles.scamBubble]}>
              {msg.isScam && msg.scamResult && (
                <View style={styles.scamAlertHeader}>
                  <Text style={styles.scamAlertHeaderText}>{scamRiskEmoji(msg.scamResult.risk_level)} Scam Alert — {String(msg.scamResult.risk_level||"")}</Text>
                </View>
              )}
              {renderMessageWithJargon(msg.text, msg.jargon, msg.isScam)}
              {msg.scamResult && msg.scamResult.risk_level !== "SAFE" && (
                <TouchableOpacity style={[styles.scamDetailBtn,{borderColor:scamRiskColor(msg.scamResult.risk_level)}]} onPress={() => setScamSheet({visible:true,data:msg.scamResult})}>
                  <Text style={[styles.scamDetailBtnText,{color:scamRiskColor(msg.scamResult.risk_level)}]}>View Scam Report →</Text>
                </TouchableOpacity>
              )}
              {msg.sender === 'bot' && (
                <View style={styles.speakRow}>
                  <TouchableOpacity onPress={() => speakMessage(msg.text)} style={styles.speakBtn}><Text style={styles.speakBtnText}>🔊 Read</Text></TouchableOpacity>
                  <TouchableOpacity onPress={stopSpeaking} style={styles.speakBtn}><Text style={styles.speakBtnText}>⏹ Stop</Text></TouchableOpacity>
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

      <View style={styles.footerContainer}>
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.iconButton} onPress={pickImageAndAnalyze}>
            <Text style={styles.iconButtonText}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconButton, isRecording&&styles.micButtonActive]} onPress={handleMicPress} disabled={isLoading&&!isRecording}>
            <Text style={styles.iconButtonText}>{isRecording ? "🔴" : "🎤"}</Text>
          </TouchableOpacity>
          <TextInput style={styles.textInput}
            placeholder={isRecording?"Recording... tap mic to stop":visionContext?"Ask about the document...":"Type or speak in any language..."}
            value={inputText} onChangeText={setInputText} multiline editable={!isRecording} />
          <TouchableOpacity style={[styles.sendButton,(isLoading||isRecording)&&styles.sendButtonDisabled]} onPress={() => sendMessage()} disabled={isLoading||isRecording}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>

        {/* Voice Mode Button */}
        <TouchableOpacity style={voiceStyles.voiceModeBtn} onPress={toggleVoiceMode}>
          <Text style={voiceStyles.voiceModeBtnText}>🎙️ Voice Mode — Tap to talk hands-free</Text>
        </TouchableOpacity>

        {isRecording
          ? <Text style={styles.recordingHint}>Tap the red button to stop recording</Text>
          : <Text style={styles.disclaimerText}>AI can make mistakes. Please double-check important information.</Text>
        }
      </View>

      {/* SOS Modal */}
      <Modal visible={sosSheet} transparent animationType="slide" onRequestClose={() => setSosSheet(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSosSheet(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.scamSheetTitle}>🚨 Emergency Offline Help</Text>
            <Text style={styles.scamVerdict}>Tap an issue below for immediate offline instructions:</Text>
            <ScrollView style={{ maxHeight:450, marginBottom:15 }}>
              {EMERGENCY_FAQS.map(faq => (
                <View key={faq.id} style={styles.sosListItem}>
                  <TouchableOpacity style={{flex:1}} onPress={() => { setSosSheet(false); handleFaqPress(faq); }}>
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
      <Modal visible={jargonSheet.visible} transparent animationType="slide" onRequestClose={() => setJargonSheet({visible:false,term:"",explanation:""})}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setJargonSheet({visible:false,term:"",explanation:""})}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.jargonLabel}>📖 Jargon Buster</Text>
            <Text style={styles.jargonTerm}>{String(jargonSheet.term||"")}</Text>
            <Text style={styles.jargonExplanation}>{String(jargonSheet.explanation||"")}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setJargonSheet({visible:false,term:"",explanation:""})}>
              <Text style={styles.sheetCloseBtnText}>Got it ✓</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Scam Sheet */}
      <Modal visible={scamSheet.visible} transparent animationType="slide" onRequestClose={() => setScamSheet({visible:false,data:null})}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setScamSheet({visible:false,data:null})}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            {scamSheet.data && (() => {
              const d = scamSheet.data;
              const level = String(d.risk_level||d.risk||"UNKNOWN");
              const color = scamRiskColor(level);
              const emoji = scamRiskEmoji(level);
              return (
                <>
                  <Text style={styles.scamSheetTitle}>🛡️ Scam Shield Report</Text>
                  <View style={[styles.scamRiskBanner,{backgroundColor:color}]}><Text style={styles.scamRiskBannerText}>{emoji} Risk Level: {level}</Text></View>
                  <Text style={styles.scamVerdict}>{String(d.verdict||d.warning||"")}</Text>
                  {Array.isArray(d.red_flags) && d.red_flags.length > 0 && (
                    <View style={styles.scamSection}>
                      <Text style={styles.scamSectionTitle}>🚩 Red Flags Detected</Text>
                      {d.red_flags.map((f,i) => <Text key={i} style={styles.scamRedFlag}>• {String(f||"")}</Text>)}
                    </View>
                  )}
                  {level === "HIGH" && (
                    <View style={styles.scamWarningBox}>
                      <Text style={styles.scamWarningText}>⚠️ Do NOT provide personal info or click any links.{'\n'}Report scams: CyberSecurity Malaysia 1-300-88-2999</Text>
                    </View>
                  )}
                  <TouchableOpacity style={[styles.sheetCloseBtn,{backgroundColor:color}]} onPress={() => setScamSheet({visible:false,data:null})}>
                    <Text style={styles.sheetCloseBtnText}>Close</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const voiceStyles = StyleSheet.create({
  overlay:        { flex:1, backgroundColor:'#0a0a0a' },
  chatBg:         { flex:1, padding:10, opacity:0.4 },
  panel: {
    position:'absolute', bottom:0, left:0, right:0,
    backgroundColor:'#1a1a1a', borderTopLeftRadius:24, borderTopRightRadius:24,
    padding:32, alignItems:'center', paddingBottom:48,
  },
  statusEmoji:    { fontSize:64, marginBottom:12 },
  statusLabel:    { fontSize:22, fontWeight:'bold', textAlign:'center', marginBottom:24, lineHeight:30 },
  stopBtn: {
    backgroundColor:'#e53935', borderRadius:16,
    paddingVertical:14, paddingHorizontal:40, marginBottom:16, width:'100%', alignItems:'center',
  },
  stopBtnText:    { color:'white', fontSize:16, fontWeight:'bold' },
  exitBtn: {
    borderWidth:1, borderColor:'#555', borderRadius:16,
    paddingVertical:12, paddingHorizontal:40, width:'100%', alignItems:'center',
  },
  exitBtnText:    { color:'#aaa', fontSize:14 },
  voiceModeBtn: {
    backgroundColor:'#075e54', marginHorizontal:10, marginBottom:6,
    borderRadius:12, paddingVertical:10, alignItems:'center',
  },
  voiceModeBtnText: { color:'white', fontSize:13, fontWeight:'bold' },
});