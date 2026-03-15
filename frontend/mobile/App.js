import React, { useState, useRef } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator 
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function App() {
  // ⚠️ CRITICAL FOR EXPO: Replace with your PC's actual IPv4 address (e.g., '192.168.1.15')
  const BACKEND_URL = 'http://192.168.68.109:8000/chat/'; 

  const [messages, setMessages] = useState([
    { id: 1, text: "Welcome to SilaSpeak! Ask me any question about government policies.", sender: "bot" }
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLang, setSelectedLang] = useState("ms"); // Default to Malay
  const scrollViewRef = useRef();

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'ms', label: 'Malay' },
    { code: 'zh', label: '中文' },
    { code: 'ta', label: 'தமிழ்' }
  ];

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage = { id: Date.now(), text: inputText, sender: "user" };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.text,
          language: selectedLang,
          simplify: true
        })
      });

      if (!response.ok) throw new Error("Network response was not ok");
      
      const data = await response.json();
      
      const botMessage = { 
        id: Date.now() + 1, 
        text: data.reply, 
        sender: "bot" 
      };
      setMessages((prev) => [...prev, botMessage]);

    } catch (error) {
      console.error(error);
      const errorMessage = { 
        id: Date.now() + 1, 
        text: "Sorry, I couldn't reach the server. Make sure your IP address is correct and the Python backend is running!", 
        sender: "bot" 
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
        <Text style={styles.headerSubtitle}>Inclusive Public Services</Text>
      </View>

      {/* Language Selector */}
      <View style={styles.langContainer}>
        {languages.map((lang) => (
          <TouchableOpacity 
            key={lang.code}
            style={[styles.langButton, selectedLang === lang.code && styles.langButtonActive]}
            onClick={() => setSelectedLang(lang.code)}
            onPress={() => setSelectedLang(lang.code)}
          >
            <Text style={[styles.langText, selectedLang === lang.code && styles.langTextActive]}>
              {lang.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chat Area */}
      <ScrollView 
        style={styles.chatArea}
        ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current.scrollToEnd({ animated: true })}
      >
        {messages.map((msg) => (
          <View key={msg.id} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
            <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.botBubble]}>
              <Text style={styles.messageText}>{msg.text}</Text>
            </View>
          </View>
        ))}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#128c7e" />
            <Text style={styles.loadingText}>Translating & Simplifying...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input Area */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder={`Ask in any language...`}
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage} disabled={isLoading}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ece5dd' },
  header: {
    backgroundColor: '#075e54',
    paddingTop: 50,
    paddingBottom: 15,
    alignItems: 'center',
    elevation: 4,
  },
  headerTitle: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle: { color: '#dcf8c6', fontSize: 12 },
  langContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#ddd'
  },
  langButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: '#f0f0f0'
  },
  langButtonActive: { backgroundColor: '#128c7e' },
  langText: { fontSize: 13, color: '#555' },
  langTextActive: { color: 'white', fontWeight: 'bold' },
  chatArea: { flex: 1, padding: 10 },
  messageRow: { marginBottom: 15, flexDirection: 'row' },
  userRow: { justifyContent: 'flex-end' },
  botRow: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 15,
    elevation: 1,
  },
  userBubble: { backgroundColor: '#dcf8c6', borderTopRightRadius: 0 },
  botBubble: { backgroundColor: 'white', borderTopLeftRadius: 0 },
  messageText: { fontSize: 15, color: '#303030', lineHeight: 20 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  loadingText: { marginLeft: 10, fontStyle: 'italic', color: '#666' },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: 'white',
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#128c7e',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginLeft: 10,
    justifyContent: 'center',
  },
  sendButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
});