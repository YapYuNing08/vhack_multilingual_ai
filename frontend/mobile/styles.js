import { StyleSheet, Platform } from 'react-native';

export const styles = StyleSheet.create({
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

  // ── Apply banner ──────────────────────────────────────────────────────────
  applyBanner: {
    backgroundColor: '#1565c0', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  applyBannerEmoji:   { fontSize: 24 },
  applyBannerTitle:   { color: 'white', fontWeight: 'bold', fontSize: 14 },
  applyBannerSub:     { color: '#90caf9', fontSize: 11, marginTop: 1 },
  applyBannerArrow:   { color: 'white', fontSize: 22, marginLeft: 'auto' },

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
  scamBubble:         { backgroundColor: '#fff5f5', borderWidth: 1.5, borderColor: '#c62828', borderTopLeftRadius: 0 },
  completeBubble:     { backgroundColor: '#e8f5e9', borderWidth: 1.5, borderColor: '#2e7d32' },
  completeText:       { color: '#1b5e20' },

  scamAlertHeader: {
    backgroundColor: '#c62828', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8, alignSelf: 'flex-start',
  },
  scamAlertHeaderText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  messageText:        { fontSize: 15, color: '#303030', lineHeight: 22 },
  scamMessageText:    { color: '#b71c1c' },
  jargonUnderline: {
    textDecorationLine: 'underline', textDecorationStyle: 'solid',
    textDecorationColor: '#075e54', color: '#075e54', fontWeight: '600',
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

  // ── WhatsApp Style Input & Bottom Controls ────────────────────────────────
  bottomControlsWrapper: {
    backgroundColor: '#ece5dd',
    paddingBottom: Platform.OS === 'ios' ? 15 : 10,
    paddingTop: 5,
  },
  whatsappInputRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  whatsappTextInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 24,
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    elevation: 1,
  },
  whatsappTextInput: {
    flex: 1,
    maxHeight: 100,
    fontSize: 16,
    paddingTop: Platform.OS === 'ios' ? 4 : 0,
    paddingBottom: Platform.OS === 'ios' ? 4 : 0,
    minHeight: 24,
    color: '#000',
  },
  whatsappCameraBtn: {
    paddingHorizontal: 8,
    paddingBottom: 2,
  },
  whatsappCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#128c7e', 
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  disclaimerText: {
    textAlign: 'center',
    fontSize: 10,
    color: '#888',
    marginTop: 4,
    paddingHorizontal: 20,
  },

  // ── Form screen ───────────────────────────────────────────────────────────
  formHeader: {
    backgroundColor: '#1565c0', paddingTop: 50, paddingBottom: 12, paddingHorizontal: 16,
  },
  backBtn:            { marginBottom: 6 },
  backBtnText:        { color: '#90caf9', fontSize: 14 },
  formHeaderCenter:   { marginBottom: 8 },
  formHeaderTitle:    { color: 'white', fontSize: 18, fontWeight: 'bold' },
  formHeaderSub:      { color: '#90caf9', fontSize: 12 },
  formLangRow:        { flexDirection: 'row', gap: 6 },
  formLangBtn: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  formLangBtnActive:      { backgroundColor: 'white' },
  formLangBtnText:        { color: 'white', fontSize: 12, fontWeight: '600' },
  formLangBtnTextActive:  { color: '#1565c0' },
  progressBar: {
    height: 4, backgroundColor: '#bbdefb',
  },
  progressFill:       { height: 4, backgroundColor: '#1565c0' },
  progressText:       { textAlign: 'center', fontSize: 12, color: '#666', paddingVertical: 4 },

  formCompleteBar: {
    padding: 16, backgroundColor: 'white', gap: 10,
  },
  downloadBtn: {
    backgroundColor: '#1565c0', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  downloadBtnDisabled:{ backgroundColor: '#90caf9' },
  downloadBtnText:    { color: 'white', fontWeight: 'bold', fontSize: 16 },
  restartBtn: {
    borderWidth: 1, borderColor: '#1565c0', borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  restartBtnText:     { color: '#1565c0', fontWeight: 'bold', fontSize: 14 },

  // ── Eligibility Wizard ──────────────────────────────────────────────────
  eligibilityBtn: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  eligibilityBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  eligibilityInput: {
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 15,
    fontSize: 18,
    marginBottom: 15,
  },
  eligibilityPrimaryBtn: {
    backgroundColor: '#1565c0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  eligibilityPrimaryBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // ── Modals ────────────────────────────────────────────────────────────────
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

  // FAQ Emergency 
  faqContainer: {
    backgroundColor: 'white',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  faqChip: {
    backgroundColor: '#ffebeb',
    borderColor: '#ffcdd2',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    marginHorizontal: 5,
    justifyContent: 'center',
  },
  faqChipText: {
    color: '#c62828',
    fontWeight: 'bold',
    fontSize: 13,
  },

  // SOS Button & Modal
  sosButton: {
    backgroundColor: '#c62828', paddingVertical: 6,
    paddingHorizontal: 12, borderRadius: 15,
  },
  sosButtonText: { color: 'white', fontSize: 13, fontWeight: 'bold' },
  sosListItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row', 
    alignItems: 'center',
  },
  sosListTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#c62828',
    marginBottom: 4,
  },
  sosListPreview: {
    fontSize: 13,
    color: '#666',
  },
  sosCallBtn: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginLeft: 10,
  },
  sosCallBtnText: {
    color: '#2e7d32',
    fontWeight: 'bold',
    fontSize: 13,
  },
});

// ── Voice Mode styles ─────────────────────────────────────────────────────────
export const voiceStyles = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: '#0a0a0a' },
  chatBg:           { flex: 1, padding: 10, opacity: 0.4 },
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 28, alignItems: 'center', paddingBottom: 48,
  },
  statusEmoji:      { fontSize: 60, marginBottom: 10 },
  statusLabel:      { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, lineHeight: 28 },
  countdownBox: {
    width: '100%', height: 24, backgroundColor: '#333', borderRadius: 12,
    marginBottom: 14, overflow: 'hidden', justifyContent: 'center',
  },
  countdownFill:    { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#e53935', borderRadius: 12 },
  countdownText:    { textAlign: 'center', color: 'white', fontSize: 11, fontWeight: 'bold', zIndex: 1 },
  stopBtn: {
    backgroundColor: '#e53935', borderRadius: 16, paddingVertical: 14,
    paddingHorizontal: 40, marginBottom: 12, width: '100%', alignItems: 'center',
  },
  stopBtnText:      { color: 'white', fontSize: 15, fontWeight: 'bold' },
  exitBtn: {
    borderWidth: 1, borderColor: '#555', borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 40, width: '100%', alignItems: 'center',
  },
  exitBtnText:      { color: '#aaa', fontSize: 14 },
  voiceModeBtn: {
    backgroundColor: '#075e54', marginHorizontal: 10, marginBottom: 4,
    borderRadius: 12, paddingVertical: 10, alignItems: 'center',
  },
  voiceModeBtnText: { color: 'white', fontSize: 13, fontWeight: 'bold' },
});

// ── Eligibility result bubble styles ─────────────────────────────────────────
export const eligStyles = StyleSheet.create({
  eligibleBubble:    { backgroundColor: '#e8f5e9', borderWidth: 1.5, borderColor: '#2e7d32' },
  notEligibleBubble: { backgroundColor: '#fff3e0', borderWidth: 1.5, borderColor: '#e65100' },
  eligibleText:      { color: '#1b5e20' },
  notEligibleText:   { color: '#bf360c' },
});

// ── Docs button styles ───────────────────────────────────────────────────────
export const docStyles = StyleSheet.create({
  docsBtn:         { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 15 },
  docsBtnText:     { fontSize: 18 },
});