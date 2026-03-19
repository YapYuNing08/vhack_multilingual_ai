import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';

// expo-file-system is native only — safe import
let FileSystem = null;
try { FileSystem = require('expo-file-system'); } catch(e) {}

export default function App() {
  const BACKEND_URL = 'http://192.168.0.7:8000'; // ⚠️ Replace with your IPv4

  const initialMessage = {
    id: 1,
    text: "Welcome to SilaSpeak!\nAsk me anything about Malaysian government services in ANY language.\n\nTap the camera to snap a photo of a letter, or tap the mic to record your voice!",
    sender: "bot"
  };

  const [messages,      setMessages]      = useState([initialMessage]);
  const [inputText,     setInputText]     = useState("");
  const [isLoading,     setIsLoading]     = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [language,      setLanguage]      = useState("en");
  const [visionContext, setVisionContext] = useState(null);

  const scrollViewRef    = useRef();
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

  const clearChat = () => {
    setMessages([initialMessage]);
    historyRef.current = [];
    setVisionContext(null);
  };

  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // ── Text-to-Speech ────────────────────────────────────────────────────────
  const speakMessage = (text) => {
    const cleanText = text
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u2600-\u27BF]/gu, '')
      .replace(/[•·●◆✦✅🔴🟡🟢]/gu, '')
      .replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (Platform.OS === 'web') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const langMap = { en: "en-US", ms: "ms-MY", zh: "zh-CN", ta: "ta-IN" };
      utterance.lang = langMap[language] || "en-US";
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } else {
      Speech.stop();
      const langMap = { en: "en-US", ms: "ms-MY", zh: "zh-CN", ta: "ta-IN" };
      Speech.speak(cleanText, { language: langMap[language] || "en-US", rate: 0.9 });
    }
  };

  const stopSpeaking = () => {
    if (Platform.OS === 'web') {
      window.speechSynthesis.cancel();
    } else {
      Speech.stop();
    }
  };

  // ── 📸 Image Analysis ─────────────────────────────────────────────────────
  const pickImageAndAnalyze = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setMessages(prev => [...prev, { id: Date.now(), text: "Uploaded a document for analysis.", sender: "user" }]);
        setIsLoading(true);
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("language", language);
          const response = await fetch(`${BACKEND_URL}/vision/`, { method: 'POST', body: formData });
          if (!response.ok) throw new Error("Vision API failed");
          const data = await response.json();
          setVisionContext(data.explanation);
          setMessages(prev => [...prev, {
            id: Date.now() + 1,
            text: data.explanation + "\n\nYou can now ask follow-up questions about this document!",
            sender: "bot"
          }]);
        } catch (error) {
          setMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, couldn't process the image.", sender: "bot" }]);
        } finally {
          setIsLoading(false);
        }
      };
      input.click();
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      showAlert("Permission Required", "We need access to your photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (result.canceled) return;

    const imageUri = result.assets[0].uri;
    setMessages(prev => [...prev, { id: Date.now(), text: "Uploaded a document for analysis.", sender: "user" }]);
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", { uri: imageUri, name: "document.jpg", type: "image/jpeg" });
      formData.append("language", language);
      const response = await fetch(`${BACKEND_URL}/vision/`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error("Vision API failed");
      const data = await response.json();
      setVisionContext(data.explanation);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: data.explanation + "\n\nYou can now ask follow-up questions!",
        sender: "bot"
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { id: Date.now() + 1, text: "Sorry, couldn't process the image.", sender: "bot" }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── 🎤 Mic ────────────────────────────────────────────────────────────────
  const handleMicPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
        console.log("[Voice] Web recording started...");
      } catch (err) {
        console.error("[Voice] Web mic error:", err);
        showAlert("Microphone Error", "Please allow microphone permission in your browser.");
      }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) { showAlert("Permission needed", "Microphone access is required."); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording;
        setIsRecording(true);
        console.log("[Voice] Native recording started...");
      } catch (err) {
        console.error("[Voice] Native mic error:", err);
        showAlert("Error", "Failed to start recording.");
      }
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setIsLoading(true);

    try {
      if (Platform.OS === 'web') {
        await new Promise((resolve) => {
          mediaRecorderRef.current.onstop = resolve;
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        });

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log("[Voice] Blob size:", audioBlob.size, "bytes");

        if (audioBlob.size < 500) {
          showAlert("Too Short", "Please speak for at least 2 seconds.");
          setIsLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        const response = await fetch(`${BACKEND_URL}/transcribe/`, {
          method: "POST",
          body:   formData,
        });

        console.log("[Voice] Status:", response.status);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(err.detail || "Transcription failed");
        }

        const data = await response.json();
        console.log("[Voice] Transcribed:", data.text);
        if (data.text && data.text.trim()) {
          setInputText(data.text.trim());
        } else {
          showAlert("No Speech", "Could not detect speech. Please try again.");
        }

      } else {
        if (!recordingRef.current) return;

        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (!uri) { showAlert("Voice Error", "No audio captured."); return; }

        await new Promise(resolve => setTimeout(resolve, 800));

        // Check file size if FileSystem available
        if (FileSystem) {
          const fileInfo = await FileSystem.getInfoAsync(uri);
          console.log("[Voice] File size:", fileInfo.size, "bytes");
          if (!fileInfo.exists || fileInfo.size < 500) {
            showAlert("Too Short", "Please speak for at least 2 seconds.");
            return;
          }
        }

        const formData = new FormData();
        formData.append("file", { uri, name: "recording.m4a", type: "audio/m4a" });

        const response = await fetch(`${BACKEND_URL}/transcribe/`, {
          method:  "POST",
          headers: { "Content-Type": "multipart/form-data" },
          body:    formData,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(err.detail);
        }

        const data = await response.json();
        console.log("[Voice] Transcribed:", data.text);
        if (data.text && data.text.trim()) {
          setInputText(data.text.trim());
        } else {
          showAlert("No Speech", "Could not detect speech. Please try again.");
        }
      }
    } catch (err) {
      console.error("[Voice] Error:", err);
      showAlert("Voice Error", err.message || "Could not transcribe audio.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── 💬 Send Message ───────────────────────────────────────────────────────
  const sendMessage = async (textOverride) => {
    const text = textOverride || inputText;
    if (!text.trim()) return;

    setMessages(prev => [...prev, { id: Date.now(), text, sender: "user" }]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/chat/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:        text,
          language:       language,
          simplify:       true,
          history:        historyRef.current,
          vision_context: visionContext,
        })
      });

      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();
      setMessages(prev => [...prev, { id: Date.now() + 1, text: data.reply, sender: "bot" }]);

      historyRef.current = [
        ...historyRef.current,
        { role: "user",      content: text       },
        { role: "assistant", content: data.reply  },
      ].slice(-6);

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: "Sorry, I couldn't reach the server. Make sure the backend is running!",
        sender: "bot"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak</Text>
          <Text style={styles.headerSubtitle}>Ask in any language • I'll reply in kind</Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.langBar}>
        <Text style={styles.langLabel}>Reply in:</Text>
        {LANGUAGES.map(l => (
          <TouchableOpacity
            key={l.code}
            style={[styles.langBtn, language === l.code && styles.langBtnActive]}
            onPress={() => setLanguage(l.code)}
          >
            <Text style={[styles.langBtnText, language === l.code && styles.langBtnTextActive]}>
              {l.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {visionContext && (
        <View style={styles.contextBanner}>
          <Text style={styles.contextBannerText}>Document loaded — ask follow-up questions!</Text>
          <TouchableOpacity onPress={() => setVisionContext(null)}>
            <Text style={styles.contextBannerClear}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={styles.chatArea}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
        ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg, index) => (
          <View key={msg.id || index} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
            <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble]}>
              <Text style={styles.messageText} selectable={true}>{msg.text}</Text>
              {msg.sender === 'bot' && (
                <View style={styles.speakRow}>
                  <TouchableOpacity onPress={() => speakMessage(msg.text)} style={styles.speakBtn}>
                    <Text style={styles.speakBtnText}>🔊 Read</Text>
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
            <Text style={styles.loadingText}>
              {isRecording ? "Recording... tap mic to stop" : "Thinking..."}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footerContainer}>
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.iconButton} onPress={pickImageAndAnalyze}>
            <Text style={styles.iconButtonText}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, isRecording && styles.micButtonActive]}
            onPress={handleMicPress}
            disabled={isLoading && !isRecording}
          >
            <Text style={styles.iconButtonText}>{isRecording ? "🔴" : "🎤"}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            placeholder={
              isRecording ? "Recording... tap mic to stop" :
              visionContext ? "Ask about the document..." :
              "Type or speak in any language..."
            }
            value={inputText}
            onChangeText={setInputText}
            multiline
            editable={!isRecording}
          />
          <TouchableOpacity
            style={[styles.sendButton, (isLoading || isRecording) && styles.sendButtonDisabled]}
            onPress={() => sendMessage()}
            disabled={isLoading || isRecording}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
        {isRecording
          ? <Text style={styles.recordingHint}>Tap the red button to stop recording</Text>
          : <Text style={styles.disclaimerText}>AI can make mistakes. Please double-check important information.</Text>
        }
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#ece5dd' },
  header: {
    backgroundColor: '#075e54', paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle:        { color: 'white', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle:     { color: '#dcf8c6', fontSize: 11 },
  clearButton:        { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  clearButtonText:    { color: 'white', fontSize: 13, fontWeight: 'bold' },
  langBar:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#128c7e', paddingHorizontal: 12, paddingVertical: 8 },
  langLabel:          { color: 'white', fontSize: 12, marginRight: 8 },
  langBtn:            { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginRight: 6, backgroundColor: 'rgba(255,255,255,0.2)' },
  langBtnActive:      { backgroundColor: 'white' },
  langBtnText:        { color: 'white', fontSize: 13, fontWeight: '600' },
  langBtnTextActive:  { color: '#075e54' },
  contextBanner:      { backgroundColor: '#fff3cd', paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ffc107' },
  contextBannerText:  { fontSize: 13, color: '#856404', flex: 1 },
  contextBannerClear: { fontSize: 16, color: '#856404', fontWeight: 'bold', marginLeft: 10 },
  chatArea:           { flex: 1, padding: 10 },
  messageRow:         { marginBottom: 15, flexDirection: 'row' },
  userRow:            { justifyContent: 'flex-end' },
  botRow:             { justifyContent: 'flex-start' },
  bubble:             { maxWidth: '80%', padding: 12, borderRadius: 15, elevation: 1 },
  userBubble:         { backgroundColor: '#dcf8c6', borderTopRightRadius: 0 },
  botBubble:          { backgroundColor: 'white', borderTopLeftRadius: 0 },
  messageText:        { fontSize: 15, color: '#303030', lineHeight: 20 },
  speakRow:           { flexDirection: 'row', marginTop: 6, gap: 10 },
  speakBtn:           { marginTop: 2 },
  speakBtnText:       { fontSize: 12, color: '#128c7e' },
  loadingContainer:   { flexDirection: 'row', alignItems: 'center', padding: 10 },
  loadingText:        { marginLeft: 10, fontStyle: 'italic', color: '#666' },
  footerContainer:    { backgroundColor: 'white', paddingBottom: Platform.OS === 'ios' ? 20 : 10 },
  inputContainer:     { flexDirection: 'row', padding: 10, alignItems: 'flex-end' },
  disclaimerText:     { textAlign: 'center', fontSize: 10, color: '#888', marginBottom: 5 },
  recordingHint:      { textAlign: 'center', fontSize: 11, color: '#e53935', marginBottom: 5, fontWeight: 'bold' },
  iconButton:         { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  micButtonActive:    { backgroundColor: '#ffcccc', borderWidth: 2, borderColor: '#e53935' },
  iconButtonText:     { fontSize: 20 },
  textInput:          { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, maxHeight: 100, fontSize: 16 },
  sendButton:         { backgroundColor: '#128c7e', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 20, marginLeft: 8, justifyContent: 'center' },
  sendButtonDisabled: { backgroundColor: '#a0a0a0' },
  sendButtonText:     { color: 'white', fontWeight: 'bold', fontSize: 15 },
});