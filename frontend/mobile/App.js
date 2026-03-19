import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Modal
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';

export default function App() {
  const BACKEND_URL = 'http://192.168.0.17:8000'; // ⚠️ Replace with your IPv4

  const initialMessage = {
    id: 1,
    text: "Welcome to SilaSpeak! 🇲🇾\nAsk me anything about Malaysian government services in ANY language.\n\nTap 📷 to snap a photo of a letter for instant explanation + scam check!\n\nTip: Underlined words are jargon — tap them for a quick explanation!",
    sender: "bot",
    jargon: {},
    isScam: false,
    scamResult: null,
  };

  const [messages,      setMessages]      = useState([initialMessage]);
  const [inputText,     setInputText]     = useState("");
  const [isLoading,     setIsLoading]     = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [visionContext, setVisionContext] = useState(null);
  const [jargonSheet,   setJargonSheet]   = useState({ visible: false, term: "", explanation: "" });
  const [scamSheet,     setScamSheet]     = useState({ visible: false, data: null });

  const scrollViewRef = useRef();
  const recordingRef  = useRef(null);
  const historyRef    = useRef([]);

  const clearChat = () => {
    setMessages([initialMessage]);
    historyRef.current = [];
    setVisionContext(null);
  };

  const speakMessage = (text) => {
    if (text) Speech.speak(String(text), { language: "en-US", rate: 0.9 });
  };

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

  // ── Jargon render — null-safe, underline only ─────────────────────────────
  const renderMessageWithJargon = (text, jargon, isScam) => {
    // ✅ Guard: ensure text is always a non-null string
    const safeText   = (text != null) ? String(text) : "";
    const safeJargon = (jargon && typeof jargon === 'object') ? jargon : {};
    const baseStyle  = [styles.messageText, isScam && styles.scamMessageText];

    const terms = Object.keys(safeJargon);

    if (terms.length === 0) {
      return <Text style={baseStyle} selectable>{safeText}</Text>;
    }

    try {
      const pattern = new RegExp(
        `(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'gi'
      );
      const parts = safeText.split(pattern);

      return (
        <Text style={baseStyle} selectable>
          {parts.map((part, i) => {
            // ✅ Guard: skip null/undefined/empty parts
            if (part == null || part === '') return null;
            const matchedTerm = terms.find(t => t.toLowerCase() === part.toLowerCase());
            if (matchedTerm) {
              return (
                <Text
                  key={i}
                  style={styles.jargonUnderline}
                  onPress={() => setJargonSheet({
                    visible: true,
                    term: String(matchedTerm),
                    explanation: String(safeJargon[matchedTerm] || ""),
                  })}
                >
                  {String(part)}
                </Text>
              );
            }
            return <Text key={i}>{String(part)}</Text>;
          })}
        </Text>
      );
    } catch (e) {
      // ✅ Fallback: if regex fails for any reason, render plain text
      return <Text style={baseStyle} selectable>{safeText}</Text>;
    }
  };

  // ── 📸 Snap & Translate ───────────────────────────────────────────────────
  const pickImageAndAnalyze = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission Required", "We need access to your photos."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7,
    });
    if (result.canceled) return;

    const imageUri = result.assets[0].uri;
    setMessages(prev => [...prev, {
      id: Date.now(), text: "📷 Uploaded a document for analysis.",
      sender: "user", jargon: {}, isScam: false, scamResult: null,
    }]);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", { uri: imageUri, name: "document.jpg", type: "image/jpeg" });
      formData.append("language", "en");

      const response = await fetch(`${BACKEND_URL}/vision/`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error("Vision API failed");
      const data = await response.json();

      setVisionContext(data.explanation || "");
      triggerScamSheet(data.scam_result, 600);

      const riskLevel = data.scam_result?.risk_level;
      const isScam    = riskLevel === "HIGH" || riskLevel === "MEDIUM";

      setMessages(prev => [...prev, {
        id:         Date.now() + 1,
        text:       String(data.explanation || "") + "\n\n💬 Ask me follow-up questions about this document in any language!",
        sender:     "bot",
        jargon:     data.jargon || {},
        scamResult: data.scam_result || null,
        isScam,
      }]);
    } catch (error) {
      console.error("Vision Error:", error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: "Sorry, I couldn't process that image. Make sure the server is running!",
        sender: "bot", jargon: {}, isScam: false, scamResult: null,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── 🎤 Voice Recording ────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("Permission needed", "Microphone access required."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) { console.error(err); }
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
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.text) setInputText(String(data.text));
    } catch { Alert.alert("Voice Error", "Could not transcribe audio."); }
    finally { setIsLoading(false); }
  };

  // ── 💬 Send Message ───────────────────────────────────────────────────────
  const sendMessage = async (textOverride) => {
    const text = textOverride || inputText;
    if (!text || !text.trim()) return;

    setMessages(prev => [...prev, {
      id: Date.now(), text: String(text),
      sender: "user", jargon: {}, isScam: false, scamResult: null,
    }]);
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

      if (!response.ok) throw new Error();
      const data = await response.json();

      triggerScamSheet(data.scam_alert, 400);

      const riskLevel = data.scam_alert?.risk_level;
      const isScam    = riskLevel === "HIGH" || riskLevel === "MEDIUM";

      setMessages(prev => [...prev, {
        id:         Date.now() + 1,
        text:       String(data.reply || ""),
        sender:     "bot",
        jargon:     data.jargon || {},
        scamResult: data.scam_alert || null,
        isScam,
      }]);

      historyRef.current = [
        ...historyRef.current,
        { role: "user",      content: String(text)            },
        { role: "assistant", content: String(data.reply || "") },
      ].slice(-6);

    } catch {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: "Sorry, I couldn't reach the server. Make sure the backend is running!",
        sender: "bot", jargon: {}, isScam: false, scamResult: null,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SilaSpeak 🇲🇾</Text>
          <Text style={styles.headerSubtitle}>Ask in any language • Scam protected</Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

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
          <View key={msg.id || index}
            style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.botRow]}>
            <View style={[
              styles.bubble,
              msg.sender === 'user' ? styles.userBubble : styles.botBubble,
              msg.isScam && styles.scamBubble,
            ]}>
              {/* Scam alert header */}
              {msg.isScam && msg.scamResult && (
                <View style={styles.scamAlertHeader}>
                  <Text style={styles.scamAlertHeaderText}>
                    {scamRiskEmoji(msg.scamResult.risk_level)} Scam Alert — {String(msg.scamResult.risk_level || "")}
                  </Text>
                </View>
              )}

              {renderMessageWithJargon(msg.text, msg.jargon, msg.isScam)}

              {/* View scam report button */}
              {msg.scamResult && msg.scamResult.risk_level !== "SAFE" && (
                <TouchableOpacity
                  style={[styles.scamDetailBtn, { borderColor: scamRiskColor(msg.scamResult.risk_level) }]}
                  onPress={() => setScamSheet({ visible: true, data: msg.scamResult })}>
                  <Text style={[styles.scamDetailBtnText, { color: scamRiskColor(msg.scamResult.risk_level) }]}>
                    View Scam Report →
                  </Text>
                </TouchableOpacity>
              )}

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

      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.cameraButton} onPress={pickImageAndAnalyze}>
          <Text style={styles.cameraButtonText}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.micButton, isRecording && styles.micButtonActive]}
          onPressIn={startRecording} onPressOut={stopRecordingAndTranscribe}>
          <Text style={styles.micButtonText}>{isRecording ? "🔴" : "🎤"}</Text>
        </TouchableOpacity>
        <TextInput style={styles.textInput}
          placeholder={visionContext ? "Ask about the document..." : "Type in any language..."}
          value={inputText} onChangeText={setInputText} multiline />
        <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()} disabled={isLoading}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>

      {/* ── Jargon Sheet ── */}
      <Modal visible={jargonSheet.visible} transparent animationType="slide"
        onRequestClose={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
          onPress={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.jargonLabel}>📖 Jargon Buster</Text>
            <Text style={styles.jargonTerm}>{String(jargonSheet.term || "")}</Text>
            <Text style={styles.jargonExplanation}>{String(jargonSheet.explanation || "")}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn}
              onPress={() => setJargonSheet({ visible: false, term: "", explanation: "" })}>
              <Text style={styles.sheetCloseBtnText}>Got it ✓</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Scam Shield Sheet ── */}
      <Modal visible={scamSheet.visible} transparent animationType="slide"
        onRequestClose={() => setScamSheet({ visible: false, data: null })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
          onPress={() => setScamSheet({ visible: false, data: null })}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            {scamSheet.data && (() => {
              const d     = scamSheet.data;
              const level = String(d.risk_level || d.risk || "UNKNOWN");
              const color = scamRiskColor(level);
              const emoji = scamRiskEmoji(level);
              return (
                <>
                  <Text style={styles.scamSheetTitle}>🛡️ Scam Shield Report</Text>
                  <View style={[styles.scamRiskBanner, { backgroundColor: color }]}>
                    <Text style={styles.scamRiskBannerText}>{emoji} Risk Level: {level}</Text>
                  </View>
                  <Text style={styles.scamVerdict}>{String(d.verdict || d.warning || "")}</Text>

                  {Array.isArray(d.red_flags) && d.red_flags.length > 0 && (
                    <View style={styles.scamSection}>
                      <Text style={styles.scamSectionTitle}>🚩 Red Flags Detected</Text>
                      {d.red_flags.map((f, i) => (
                        <Text key={i} style={styles.scamRedFlag}>• {String(f || "")}</Text>
                      ))}
                    </View>
                  )}

                  {level === "HIGH" && (
                    <View style={styles.scamWarningBox}>
                      <Text style={styles.scamWarningText}>
                        ⚠️ Do NOT provide personal info or click any links.{'\n'}
                        Report scams: CyberSecurity Malaysia 1-300-88-2999
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity style={[styles.sheetCloseBtn, { backgroundColor: color }]}
                    onPress={() => setScamSheet({ visible: false, data: null })}>
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

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#ece5dd' },
  header: {
    backgroundColor: '#075e54', paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle:        { color: 'white', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle:     { color: '#dcf8c6', fontSize: 11 },
  clearButton: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6,
    paddingHorizontal: 12, borderRadius: 15,
  },
  clearButtonText:    { color: 'white', fontSize: 13, fontWeight: 'bold' },
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
  bubble:             { maxWidth: '82%', padding: 12, borderRadius: 15, elevation: 1 },
  userBubble:         { backgroundColor: '#dcf8c6', borderTopRightRadius: 0 },
  botBubble:          { backgroundColor: 'white', borderTopLeftRadius: 0 },
  scamBubble: {
    backgroundColor: '#fff5f5', borderWidth: 1.5,
    borderColor: '#c62828', borderTopLeftRadius: 0,
  },
  scamAlertHeader: {
    backgroundColor: '#c62828', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    marginBottom: 8, alignSelf: 'flex-start',
  },
  scamAlertHeaderText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  messageText:        { fontSize: 15, color: '#303030', lineHeight: 22 },
  scamMessageText:    { color: '#b71c1c' },
  jargonUnderline: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: '#075e54',
    color: '#075e54',
    fontWeight: '600',
  },
  scamDetailBtn: {
    marginTop: 8, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start',
  },
  scamDetailBtnText:  { fontSize: 12, fontWeight: 'bold' },
  speakBtn:           { marginTop: 6 },
  speakBtnText:       { fontSize: 12, color: '#128c7e', fontWeight: 'bold' },
  loadingContainer:   { flexDirection: 'row', alignItems: 'center', padding: 10 },
  loadingText:        { marginLeft: 10, fontStyle: 'italic', color: '#666' },
  inputContainer: {
    flexDirection: 'row', padding: 10,
    backgroundColor: 'white', alignItems: 'flex-end',
  },
  cameraButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f0',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  cameraButtonText:   { fontSize: 20 },
  micButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f0',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
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
    paddingVertical: 12, paddingHorizontal: 20, marginLeft: 8, justifyContent: 'center',
  },
  sendButtonText:     { color: 'white', fontWeight: 'bold', fontSize: 15 },
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  bottomSheet: {
    backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 44, maxHeight: '80%',
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: '#ddd',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  jargonLabel:        { fontSize: 13, color: '#888', marginBottom: 6 },
  jargonTerm:         { fontSize: 24, fontWeight: 'bold', color: '#075e54', marginBottom: 12 },
  jargonExplanation:  { fontSize: 16, color: '#333', lineHeight: 24, marginBottom: 24 },
  sheetCloseBtn: {
    backgroundColor: '#075e54', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  sheetCloseBtnText:  { color: 'white', fontWeight: 'bold', fontSize: 16 },
  scamSheetTitle:     { fontSize: 20, fontWeight: 'bold', color: '#212121', marginBottom: 12 },
  scamRiskBanner: {
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 12,
  },
  scamRiskBannerText: { color: 'white', fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  scamVerdict:        { fontSize: 14, color: '#444', marginBottom: 16, lineHeight: 20 },
  scamSection:        { marginBottom: 14 },
  scamSectionTitle:   { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  scamRedFlag:        { fontSize: 13, color: '#c62828', marginBottom: 3, lineHeight: 18 },
  scamWarningBox: {
    backgroundColor: '#fff3e0', borderRadius: 8, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#f57c00', marginBottom: 16,
  },
  scamWarningText:    { fontSize: 13, color: '#e65100', lineHeight: 20 },
});