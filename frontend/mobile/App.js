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
    text: "Welcome to SilaSpeak! 🇲🇾\nAsk me anything about Malaysian government services in ANY language — I'll reply in the same language you use!\n\nOr tap 📷 to snap a photo of a letter for instant explanation.",
    sender: "bot"
  };

  const [messages,      setMessages]      = useState([initialMessage]);
  const [inputText,     setInputText]     = useState("");
  const [isLoading,     setIsLoading]     = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [visionContext, setVisionContext] = useState(null);

  const scrollViewRef = useRef();
  const recordingRef  = useRef(null);
  const historyRef    = useRef([]);

  const clearChat = () => {
    setMessages([initialMessage]);
    historyRef.current = [];
    setVisionContext(null);
  };

  const speakMessage = (text) => {
    Speech.speak(text, { language: "en-US", rate: 0.9 });
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
    setMessages(prev => [...prev, {
      id: Date.now(), text: "📷 Uploaded a document for analysis.", sender: "user"
    }]);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", { uri: imageUri, name: "document.jpg", type: "image/jpeg" });
      formData.append("language", "en"); 

      const response = await fetch(`${BACKEND_URL}/vision/`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error("Vision API failed");
      const data = await response.json();

      setVisionContext(data.explanation);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: data.explanation + "\n\n💬 You can now ask me follow-up questions about this document in any language!",
        sender: "bot"
      }]);
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

    setMessages(prev => [...prev, { id: Date.now(), text, sender: "user" }]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:        text,
          language:       "en",   
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

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
          <Text style={styles.headerSubtitle}>Ask in any language • I'll reply in kind</Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Vision Context Banner */}
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

      {/* 🚨 UPDATED: Footer Area (Wraps input and disclaimer) */}
      <View style={styles.footerContainer}>
        {/* Input Bar */}
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
            placeholder={visionContext ? "Ask about the document..." : "Type in any language..."}
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()} disabled={isLoading}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
        
        {/* Disclaimer Text */}
        <Text style={styles.disclaimerText}>
          AI can make mistakes. Please double-check responses.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#ece5dd' },
  header: {
    backgroundColor: '#075e54',
    paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle:       { color: 'white', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle:    { color: '#dcf8c6', fontSize: 11 },
  clearButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15,
  },
  clearButtonText:   { color: 'white', fontSize: 13, fontWeight: 'bold' },
  contextBanner: {
    backgroundColor: '#fff3cd', paddingHorizontal: 16, paddingVertical: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#ffc107',
  },
  contextBannerText:  { fontSize: 13, color: '#856404', flex: 1 },
  contextBannerClear: { fontSize: 16, color: '#856404', fontWeight: 'bold', marginLeft: 10 },
  chatArea:          { flex: 1, padding: 10 },
  messageRow:        { marginBottom: 15, flexDirection: 'row' },
  userRow:           { justifyContent: 'flex-end' },
  botRow:            { justifyContent: 'flex-start' },
  bubble:            { maxWidth: '80%', padding: 12, borderRadius: 15, elevation: 1 },
  userBubble:        { backgroundColor: '#dcf8c6', borderTopRightRadius: 0 },
  botBubble:         { backgroundColor: 'white',   borderTopLeftRadius: 0 },
  messageText:       { fontSize: 15, color: '#303030', lineHeight: 20 },
  speakBtn:          { marginTop: 6 },
  speakBtnText:      { fontSize: 12, color: '#128c7e', fontWeight: 'bold' },
  loadingContainer:  { flexDirection: 'row', alignItems: 'center', padding: 10 },
  loadingText:       { marginLeft: 10, fontStyle: 'italic', color: '#666' },
  
  // 🚨 NEW STYLES: Footer, Input, and Disclaimer
  footerContainer: {
    backgroundColor: 'white',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10, // Adds safe area padding at the very bottom
  },
  inputContainer: {
    flexDirection: 'row', padding: 10,
    alignItems: 'flex-end', // Kept this to align buttons to the bottom of multi-line text
  },
  disclaimerText: {
    textAlign: 'center',
    fontSize: 10,
    color: '#888',
    marginBottom: 5,
  },
  
  cameraButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#f0f0f0', justifyContent: 'center',
    alignItems: 'center', marginRight: 8,
  },
  cameraButtonText:  { fontSize: 20 },
  micButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#f0f0f0', justifyContent: 'center',
    alignItems: 'center', marginRight: 8,
  },
  micButtonActive:   { backgroundColor: '#ffcccc' },
  micButtonText:     { fontSize: 20 },
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
  sendButtonText:    { color: 'white', fontWeight: 'bold', fontSize: 15 },
});