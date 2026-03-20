import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, TextInput, Animated, Dimensions,
  StyleSheet, Platform,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.88, 400);

const CATEGORY_CONFIG = {
  education:   { color: '#1565c0', bg: '#e3f2fd', emoji: '🎓' },
  health:      { color: '#2e7d32', bg: '#e8f5e9', emoji: '🏥' },
  tax:         { color: '#e65100', bg: '#fff3e0', emoji: '💰' },
  welfare:     { color: '#6a1b9a', bg: '#f3e5f5', emoji: '🤝' },
  housing:     { color: '#00695c', bg: '#e0f2f1', emoji: '🏠' },
  employment:  { color: '#0277bd', bg: '#e1f5fe', emoji: '💼' },
  legal:       { color: '#c62828', bg: '#ffebee', emoji: '⚖️' },
  transport:   { color: '#558b2f', bg: '#f1f8e9', emoji: '🚗' },
  environment: { color: '#2e7d32', bg: '#e8f5e9', emoji: '🌿' },
  general:     { color: '#546e7a', bg: '#eceff1', emoji: '📄' },
};

const METHOD_CONFIG = {
  text_layer: { label: 'Text PDF', color: '#2e7d32', emoji: '📝' },
  vision_ocr: { label: 'Scanned',  color: '#e65100', emoji: '🔍' },
  unknown:    { label: 'Unknown',  color: '#757575', emoji: '❓' },
};

export default function DocumentsDrawer({ visible, backendUrl, onClose }) {
  const [docs,         setDocs]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [deleting,     setDeleting]     = useState(null);
  const [uploading,    setUploading]    = useState(false);
  const [searchText,   setSearchText]   = useState('');
  const [filterCat,    setFilterCat]    = useState('all');
  const [uploadModal,  setUploadModal]  = useState(false);
  const [selectedCat,  setSelectedCat]  = useState('general');
  const [confirmDoc,   setConfirmDoc]   = useState(null);
  const [toast,        setToast]        = useState(null);

  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // ── Open / close animation ────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      fetchDocs();
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim,   { toValue: DRAWER_WIDTH, duration: 220, useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0,            duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${backendUrl}/upload/list`);
      const data = await res.json();
      setDocs(data.documents || []);
    } catch (e) {
      console.error('[Drawer] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setToast(null));
  };

  const handleDelete = async (filename) => {
    setConfirmDoc(null);
    setDeleting(filename);
    try {
      const res  = await fetch(`${backendUrl}/upload/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        setDocs(prev => prev.filter(d => d.filename !== filename));
        showToast(`✓ Deleted "${filename}"`);
      }
    } catch (e) {
      console.error('[Drawer] Delete error:', e);
    } finally {
      setDeleting(null);
    }
  };

  const handleUpload = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.pdf';
      input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        setUploadModal(false); setUploading(true);
        try {
          const fd = new FormData();
          fd.append('file', file); fd.append('category', selectedCat);
          const res  = await fetch(`${backendUrl}/upload/`, { method: 'POST', body: fd });
          const data = await res.json();
          if (data.status === 'success') {
            showToast(`✓ "${file.name}" uploaded (${data.chunks_stored} chunks)`);
            fetchDocs();
          }
        } catch (err) { console.error('[Drawer] Upload error:', err); }
        finally { setUploading(false); }
      };
      input.click();
    } else {
      // Native file picker — dynamically imported to avoid web bundler issues
      try {
        setUploadModal(false); setUploading(true);
        let DocPicker;
        try { DocPicker = require('expo-document-picker'); } catch { setUploading(false); return; }
        const result = await DocPicker.getDocumentAsync({ type: 'application/pdf' });
        if (result.canceled) { setUploading(false); return; }
        const asset = result.assets[0];
        const fd    = new FormData();
        fd.append('file', { uri: asset.uri, name: asset.name, type: 'application/pdf' });
        fd.append('category', selectedCat);
        const res  = await fetch(`${backendUrl}/upload/`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: fd });
        const data = await res.json();
        if (data.status === 'success') {
          showToast(`\u2713 "${asset.name}" uploaded`);
          fetchDocs();
        }
      } catch (err) { console.error('[Drawer] Upload error:', err); }
      finally { setUploading(false); }
    }
  };

  // ── Filtered docs ─────────────────────────────────────────────────────────
  const filteredDocs = docs.filter(d => {
    const matchCat    = filterCat === 'all' || d.category === filterCat;
    const matchSearch = !searchText || d.filename.toLowerCase().includes(searchText.toLowerCase());
    return matchCat && matchSearch;
  });

  const totalChunks     = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);
  const getCatCfg       = (c) => CATEGORY_CONFIG[c]  || CATEGORY_CONFIG.general;
  const getMethodCfg    = (m) => METHOD_CONFIG[m]    || METHOD_CONFIG.unknown;
  const activeCats      = [...new Set(docs.map(d => d.category))];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={dr.root}>

        {/* Dim overlay */}
        <Animated.View style={[dr.overlay, { opacity: overlayAnim }]}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        </Animated.View>

        {/* Drawer panel slides in from right */}
        <Animated.View style={[dr.drawer, { transform: [{ translateX: slideAnim }] }]}>

          {/* ── Drawer Header ── */}
          <View style={dr.header}>
            <View style={dr.headerTop}>
              <View>
                <Text style={dr.headerTitle}>📚 Knowledge Base</Text>
                <Text style={dr.headerSub}>{docs.length} docs · {totalChunks} chunks</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={dr.closeBtn}>
                <Text style={dr.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search bar */}
            <View style={dr.searchBar}>
              <Text style={dr.searchIcon}>🔍</Text>
              <TextInput
                style={dr.searchInput}
                placeholder="Search documents..."
                placeholderTextColor="#aaa"
                value={searchText}
                onChangeText={setSearchText}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <Text style={dr.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Category filter chips ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={dr.filterRow} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
            {/* All chip */}
            <TouchableOpacity
              style={[dr.filterChip, filterCat === 'all' && dr.filterChipActive]}
              onPress={() => setFilterCat('all')}>
              <Text style={[dr.filterChipText, filterCat === 'all' && dr.filterChipTextActive]}>
                All ({docs.length})
              </Text>
            </TouchableOpacity>
            {/* Per-category chips — only show categories that have docs */}
            {activeCats.map(cat => {
              const cfg   = getCatCfg(cat);
              const count = docs.filter(d => d.category === cat).length;
              const active = filterCat === cat;
              return (
                <TouchableOpacity key={cat}
                  style={[dr.filterChip, active && { backgroundColor: cfg.bg, borderColor: cfg.color }]}
                  onPress={() => setFilterCat(active ? 'all' : cat)}>
                  <Text style={dr.filterChipEmoji}>{cfg.emoji}</Text>
                  <Text style={[dr.filterChipText, active && { color: cfg.color, fontWeight: 'bold' }]}>
                    {cat} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* ── Document list ── */}
          {loading ? (
            <View style={dr.centered}>
              <ActivityIndicator size="large" color="#128c7e" />
              <Text style={dr.loadingText}>Loading…</Text>
            </View>
          ) : filteredDocs.length === 0 ? (
            <View style={dr.centered}>
              <Text style={{ fontSize: 40, marginBottom: 10 }}>
                {searchText ? '🔍' : '📭'}
              </Text>
              <Text style={dr.emptyTitle}>
                {searchText ? `No results for "${searchText}"` : 'No documents yet'}
              </Text>
              <Text style={dr.emptySub}>
                {searchText ? 'Try a different search term' : 'Upload a PDF to get started'}
              </Text>
            </View>
          ) : (
            <ScrollView style={dr.list} contentContainerStyle={{ padding: 14, gap: 10 }}>
              {filteredDocs.map(doc => {
                const catCfg    = getCatCfg(doc.category);
                const methodCfg = getMethodCfg(doc.method);
                const isDeleting = deleting === doc.filename;
                return (
                  <View key={doc.filename} style={dr.card}>
                    {/* Color accent */}
                    <View style={[dr.cardAccent, { backgroundColor: catCfg.color }]} />
                    <View style={dr.cardBody}>
                      {/* Filename row */}
                      <View style={dr.cardTopRow}>
                        <Text style={dr.cardEmoji}>{catCfg.emoji}</Text>
                        <Text style={dr.cardName} numberOfLines={2}>
                          {doc.filename.replace('.pdf', '')}
                          <Text style={dr.cardExt}>.pdf</Text>
                        </Text>
                      </View>
                      {/* Badges */}
                      <View style={dr.badgeRow}>
                        <View style={[dr.badge, { backgroundColor: catCfg.bg }]}>
                          <Text style={[dr.badgeText, { color: catCfg.color }]}>{doc.category}</Text>
                        </View>
                        <View style={[dr.badge, { backgroundColor: '#f5f5f5' }]}>
                          <Text style={[dr.badgeText, { color: methodCfg.color }]}>
                            {methodCfg.emoji} {methodCfg.label}
                          </Text>
                        </View>
                        <View style={[dr.badge, { backgroundColor: '#e8f5e9' }]}>
                          <Text style={[dr.badgeText, { color: '#2e7d32' }]}>{doc.chunk_count} chunks</Text>
                        </View>
                      </View>
                    </View>
                    {/* Delete */}
                    <TouchableOpacity
                      style={dr.deleteBtn}
                      onPress={() => setConfirmDoc(doc.filename)}
                      disabled={isDeleting}>
                      {isDeleting
                        ? <ActivityIndicator size="small" color="#c62828" />
                        : <Text style={dr.deleteBtnText}>🗑</Text>
                      }
                    </TouchableOpacity>
                  </View>
                );
              })}
              <View style={{ height: 30 }} />
            </ScrollView>
          )}

          {/* ── Upload button ── */}
          <View style={dr.footer}>
            <TouchableOpacity
              style={[dr.uploadBtn, uploading && { opacity: 0.6 }]}
              onPress={() => setUploadModal(true)}
              disabled={uploading}>
              {uploading
                ? <ActivityIndicator color="white" />
                : <Text style={dr.uploadBtnText}>＋  Upload New Document</Text>
              }
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Upload category picker modal ── */}
        <Modal visible={uploadModal} transparent animationType="slide" onRequestClose={() => setUploadModal(false)}>
          <TouchableOpacity style={dr.modalOverlay} activeOpacity={1} onPress={() => setUploadModal(false)}>
            <View style={dr.modalSheet}>
              <View style={dr.sheetHandle} />
              <Text style={dr.modalTitle}>Upload Document</Text>
              <Text style={dr.modalSub}>Select a category so SilaSpeak routes questions correctly</Text>
              <View style={dr.catGrid}>
                {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
                  <TouchableOpacity key={cat}
                    style={[dr.catOption, selectedCat === cat && { backgroundColor: cfg.bg, borderColor: cfg.color, borderWidth: 2 }]}
                    onPress={() => setSelectedCat(cat)}>
                    <Text style={dr.catEmoji}>{cfg.emoji}</Text>
                    <Text style={[dr.catText, selectedCat === cat && { color: cfg.color, fontWeight: 'bold' }]}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={dr.chooseBtn} onPress={handleUpload}>
                <Text style={dr.chooseBtnText}>📂  Choose PDF File</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Confirm delete modal ── */}
        <Modal visible={!!confirmDoc} transparent animationType="fade" onRequestClose={() => setConfirmDoc(null)}>
          <View style={dr.confirmOverlay}>
            <View style={dr.confirmBox}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🗑️</Text>
              <Text style={dr.confirmTitle}>Delete Document?</Text>
              <Text style={dr.confirmMsg} numberOfLines={3}>
                "{confirmDoc}" and all its chunks will be permanently removed.
              </Text>
              <View style={dr.confirmBtns}>
                <TouchableOpacity style={dr.cancelBtn} onPress={() => setConfirmDoc(null)}>
                  <Text style={dr.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={dr.deleteConfirmBtn} onPress={() => handleDelete(confirmDoc)}>
                  <Text style={dr.deleteConfirmBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Toast ── */}
        {toast && (
          <Animated.View style={[dr.toast, {
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0,1], outputRange: [10, 0] }) }]
          }]}>
            <Text style={dr.toastText}>{toast}</Text>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const dr = StyleSheet.create({
  root:               { flex: 1, flexDirection: 'row' },
  overlay:            { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  drawer:             { position: 'absolute', top: 0, bottom: 0, right: 0, width: DRAWER_WIDTH, backgroundColor: '#f8f8f8', elevation: 16, shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: -4, height: 0 }, shadowRadius: 12 },
  header:             { backgroundColor: '#075e54', paddingTop: Platform.OS === 'ios' ? 54 : 36, paddingBottom: 12, paddingHorizontal: 16 },
  headerTop:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  headerTitle:        { color: 'white', fontSize: 17, fontWeight: 'bold' },
  headerSub:          { color: '#dcf8c6', fontSize: 11, marginTop: 2 },
  closeBtn:           { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  closeBtnText:       { color: 'white', fontSize: 14, fontWeight: 'bold' },
  searchBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  searchIcon:         { fontSize: 14 },
  searchInput:        { flex: 1, color: 'white', fontSize: 14 },
  searchClear:        { color: 'rgba(255,255,255,0.7)', fontSize: 14, paddingHorizontal: 4 },
  filterRow:          { backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee', maxHeight: 50 },
  filterChip:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa', gap: 4 },
  filterChipActive:   { backgroundColor: '#e8f5e9', borderColor: '#2e7d32' },
  filterChipEmoji:    { fontSize: 12 },
  filterChipText:     { fontSize: 12, color: '#555' },
  filterChipTextActive:{ color: '#2e7d32', fontWeight: 'bold' },
  centered:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText:        { marginTop: 10, color: '#888', fontSize: 13 },
  emptyTitle:         { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 4, textAlign: 'center' },
  emptySub:           { fontSize: 13, color: '#888', textAlign: 'center' },
  list:               { flex: 1 },
  card:               { backgroundColor: 'white', borderRadius: 12, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
  cardAccent:         { width: 4, alignSelf: 'stretch' },
  cardBody:           { flex: 1, padding: 10 },
  cardTopRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  cardEmoji:          { fontSize: 20 },
  cardName:           { flex: 1, fontSize: 12, fontWeight: '600', color: '#212121', lineHeight: 17 },
  cardExt:            { fontWeight: '400', color: '#888' },
  badgeRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  badge:              { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText:          { fontSize: 10, fontWeight: '600' },
  deleteBtn:          { padding: 14, justifyContent: 'center', alignItems: 'center' },
  deleteBtnText:      { fontSize: 18 },
  footer:             { padding: 14, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#eee' },
  uploadBtn:          { backgroundColor: '#128c7e', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  uploadBtnText:      { color: 'white', fontWeight: 'bold', fontSize: 15 },
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet:         { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 44 },
  sheetHandle:        { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle:         { fontSize: 19, fontWeight: 'bold', color: '#212121', marginBottom: 4 },
  modalSub:           { fontSize: 13, color: '#666', marginBottom: 18 },
  catGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  catOption:          { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa', flexDirection: 'row', alignItems: 'center', gap: 5 },
  catEmoji:           { fontSize: 15 },
  catText:            { fontSize: 12, color: '#555' },
  chooseBtn:          { backgroundColor: '#128c7e', borderRadius: 14, padding: 15, alignItems: 'center' },
  chooseBtnText:      { color: 'white', fontWeight: 'bold', fontSize: 15 },
  confirmOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox:         { backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%', alignItems: 'center' },
  confirmTitle:       { fontSize: 17, fontWeight: 'bold', color: '#c62828', marginBottom: 8 },
  confirmMsg:         { fontSize: 13, color: '#555', textAlign: 'center', lineHeight: 19, marginBottom: 22 },
  confirmBtns:        { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn:          { flex: 1, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 13, alignItems: 'center' },
  cancelBtnText:      { color: '#555', fontWeight: 'bold' },
  deleteConfirmBtn:   { flex: 1, backgroundColor: '#c62828', borderRadius: 12, padding: 13, alignItems: 'center' },
  deleteConfirmBtnText: { color: 'white', fontWeight: 'bold' },
  toast:              { position: 'absolute', bottom: 90, left: 14, right: 14, backgroundColor: '#212121', borderRadius: 12, padding: 13, alignItems: 'center' },
  toastText:          { color: 'white', fontWeight: 'bold', fontSize: 13 },
});