import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';

export default function App() {
  const BACKEND_URL = 'http://192.168.0.17:8000'; // ⚠️ Replace with your IPv4

  const initialMessage = {
    id: 1,
    text: "Welcome to SilaSpeak! 🇲🇾 Ask me anything about government services, or SNAP a photo of a letter to translate it!",
    sender: "bot"
  };

  const [messages,    setMessages]    = useState([initialMessage]);
  const [inputText,   setInputText]   = useState("");
  const [isLoading,   setIsLoading]   = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [language,    setLanguage]    = useState("en");

  // ✅ NEW: Store the vision result so follow-up questions can reference it
  const [visionContext, setVisionContext] = useState(null);

  const scrollViewRef = useRef();
  const recordingRef  = useRef(null);
  const historyRef    = useRef([]);

  const LANGUAGES = [
    { code: "en", label: "EN" },
    { code: "ms", label: "MS" },
    { code: "zh", label: "中文" },
    { code: "ta", label: "தமிழ்" },
  ];

  const clearChat = () => {
    setMessages([initialMessage]);
    historyRef.current = [];
    setVisionContext(null); // ✅ Clear vision context on reset
  };

  const speakMessage = (text) => {
    const langMap = { en: "en-US", ms: "ms-MY", zh: "zh-CN", ta: "ta-IN" };
    Speech.speak(text, { language: langMap[language] || "en-US", rate: 0.9 });
  };

  // ── 📸 Snap & Translate ───────────────────────────────────────────────────
  const pickImageAndAnalyze = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Permission Required", "We need access to your photos to read documents.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (result.canceled) return;

    const imageUri = result.assets[0].uri;
    const userMessage = { id: Date.now(), text: "📷 Uploaded a document for analysis.", sender: "user" };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", { uri: imageUri, name: "document.jpg", type: "image/jpeg" });
      formData.append("language", language);

      const response = await fetch(`${BACKEND_URL}/vision/`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Vision API failed");
      const data = await response.json();

      // ✅ Save the vision explanation as context for follow-up questions
      setVisionContext(data.explanation);

      // Show the result + a prompt to ask follow-up questions
      const botMessage = {
        id: Date.now() + 1,
        text: data.explanation + "\n\n💬 You can now ask me follow-up questions about this document!",
        sender: "bot"
      };
      setMessages(prev => [...prev, botMessage]);

    } catch (error) {
      console.error("Vision Error:", error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: "Sorry, I couldn't process that image. Make sure the server is running!",
        sender: "bot"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── 🎤 Voice Recording ────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("Permission needed", "Microphone access is required."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!recordingRef.current) return;
    setIsRecording(false);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsLoading(true);

      const formData = new FormData();
      formData.append("file", { uri, name: "voice.m4a", type: "audio/m4a" });
      formData.append("language", language);

      const response = await fetch(`${BACKEND_URL}/transcribe/`, { method: "POST", body: formData });
      if (!response.ok) throw new Error("Transcription failed");
      const data = await response.json();
      if (data.text) setInputText(data.text);
    } catch (err) {
      Alert.alert("Voice Error", "Could not transcribe audio. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── 💬 Send Message ───────────────────────────────────────────────────────
  const sendMessage = async (textOverride) => {
    const text = textOverride || inputText;
    if (!text.trim()) return;

    const userMessage = { id: Date.now(), text, sender: "user" };
    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:        text,
          language:       language,
          simplify:       true,
          history:        historyRef.current,
          vision_context: visionContext, // ✅ Pass vision context to backend
        })
      });

      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();

      const botMessage = { id: Date.now() + 1, text: data.reply, sender: "bot" };
      setMessages(prev => [...prev, botMessage]);

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

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
          <Text style={styles.headerSubtitle}>Inclusive Public Services</Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Language Selector */}
      <View style={styles.langBar}>
        <Text style={styles.langLabel}>Language:</Text>
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

      {/* ✅ Vision Context Banner — shown when a document is loaded */}
      {visionContext && (
        <View style={styles.contextBanner}>
          <Text style={styles.contextBannerText}>
            📄 Document loaded — ask follow-up questions below!
          </Text>
          <TouchableOpacity onPress={() => setVisionContext(null)}>
            <Text style={styles.contextBannerClear}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Chat Area */}
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
                <TouchableOpacity onPress={() => speakMessage(msg.text)} style={styles.speakBtn}>
                  <Text style={styles.speakBtnText}>🔊 Read aloud</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#128c7e" />
            <Text style={styles.loadingText}>{isRecording ? "Recording..." : "Thinking..."}</Text>
          </View>
        )}
      </ScrollView>

      {/* Input Area */}
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.cameraButton} onPress={pickImageAndAnalyze}>
          <Text style={styles.cameraButtonText}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.micButton, isRecording && styles.micButtonActive]}
          onPressIn={startRecording}
          onPressOut={stopRecordingAndTranscribe}
        >
          <Text style={styles.micButtonText}>{isRecording ? "🔴" : "🎤"}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          placeholder={visionContext ? "Ask about the document..." : "Type or speak..."}
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()} disabled={isLoading}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#ece5dd' },
  header: {
    backgroundColor: '#075e54',
    paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle:        { color: 'white', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle:     { color: '#dcf8c6', fontSize: 12 },
  clearButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15,
  },
  clearButtonText:    { color: 'white', fontSize: 13, fontWeight: 'bold' },
  langBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#128c7e', paddingHorizontal: 12, paddingVertical: 8,
  },
  langLabel:          { color: 'white', fontSize: 13, marginRight: 8 },
  langBtn: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 12, marginRight: 6, backgroundColor: 'rgba(255,255,255,0.2)',
  },
  langBtnActive:      { backgroundColor: 'white' },
  langBtnText:        { color: 'white', fontSize: 13, fontWeight: '600' },
  langBtnTextActive:  { color: '#075e54' },

  // ✅ Vision context banner
  contextBanner: {
    backgroundColor: '#fff3cd', paddingHorizontal: 16, paddingVertical: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#ffc107',
  },
  contextBannerText:  { fontSize: 13, color: '#856404', flex: 1 },
  contextBannerClear: { fontSize: 16, color: '#856404', fontWeight: 'bold', marginLeft: 10 },

  chatArea:           { flex: 1, padding: 10 },
  messageRow:         { marginBottom: 15, flexDirection: 'row' },
  userRow:            { justifyContent: 'flex-end' },
  botRow:             { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%', padding: 12, borderRadius: 15, elevation: 1,
  },
  userBubble:         { backgroundColor: '#dcf8c6', borderTopRightRadius: 0 },
  botBubble:          { backgroundColor: 'white',   borderTopLeftRadius: 0 },
  messageText:        { fontSize: 15, color: '#303030', lineHeight: 20 },
  speakBtn:           { marginTop: 6 },
  speakBtnText:       { fontSize: 12, color: '#128c7e', fontWeight: 'bold' },
  loadingContainer:   { flexDirection: 'row', alignItems: 'center', padding: 10 },
  loadingText:        { marginLeft: 10, fontStyle: 'italic', color: '#666' },
  inputContainer: {
    flexDirection: 'row', padding: 10,
    backgroundColor: 'white', alignItems: 'flex-end',
  },
  cameraButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#f0f0f0', justifyContent: 'center',
    alignItems: 'center', marginRight: 8,
  },
  cameraButtonText:   { fontSize: 20 },
  micButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#f0f0f0', justifyContent: 'center',
    alignItems: 'center', marginRight: 8,
  },
  micButtonActive:    { backgroundColor: '#ffcccc' },
  micButtonText:      { fontSize: 20 },
  textInput: {
    flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20,
    paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10,
    maxHeight: 100, fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#128c7e', borderRadius: 20,
    paddingVertical: 12, paddingHorizontal: 20, marginLeft: 8,
    justifyContent: 'center',
  },
  sendButtonText:     { color: 'white', fontWeight: 'bold', fontSize: 15 },
});