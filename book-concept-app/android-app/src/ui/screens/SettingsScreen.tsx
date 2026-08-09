import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import type {DeepSeekSettings} from '../../settings/secureSettings';
import {DEFAULT_DEEPSEEK_SETTINGS} from '../../settings/secureSettings';
import type {TtsPreferences} from '../../settings/ttsPreferences';
import {DEFAULT_TTS_PREFERENCES} from '../../settings/ttsPreferences';
import {colors} from '../theme';

interface Props {
  dependencies: {
    getDeepSeekSettings(): Promise<DeepSeekSettings>;
    setDeepSeekSettings(settings: DeepSeekSettings): Promise<void>;
    getTtsPreferences(): Promise<TtsPreferences>;
    setTtsPreferences(settings: TtsPreferences): Promise<void>;
  };
  onSaved?(): void;
}

function Choice({selected, label, onPress}: {selected: boolean; label: string; onPress(): void}) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

export default function SettingsScreen({dependencies, onSaved}: Props) {
  const savedKey = useRef('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_DEEPSEEK_SETTINGS.model);
  const [temperature, setTemperature] = useState(String(DEFAULT_DEEPSEEK_SETTINGS.temperature));
  const [timeout, setTimeoutValue] = useState(String(DEFAULT_DEEPSEEK_SETTINGS.timeoutMs));
  const [tts, setTts] = useState<TtsPreferences>(DEFAULT_TTS_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      dependencies.getDeepSeekSettings().catch(() => null),
      dependencies.getTtsPreferences(),
    ]).then(([deepSeek, ttsPreferences]) => {
      if (!active) {return;}
      if (deepSeek) {
        savedKey.current = deepSeek.apiKey;
        setModel(deepSeek.model);
        setTemperature(String(deepSeek.temperature));
        setTimeoutValue(String(deepSeek.timeoutMs));
      }
      setTts(ttsPreferences);
    }).catch(() => setError('设置加载失败')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dependencies]);

  const changeSpeed = (delta: number) => setTts(current => ({...current, speed: Math.min(2, Math.max(0.2, Math.round((current.speed + delta) * 10) / 10))}));
  const save = async () => {
    const parsedTemperature = Number(temperature);
    const parsedTimeout = Number(timeout);
    if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {return setError('温度需在 0 到 2 之间');}
    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {return setError('请求超时需在 1000 到 120000 毫秒之间');}
    const key = apiKey.trim() || savedKey.current;
    if (!key) {return setError('请输入 DeepSeek API Key');}
    setSaving(true); setError(null); setSaved(false);
    try {
      await dependencies.setDeepSeekSettings({apiKey: key, apiBase: DEFAULT_DEEPSEEK_SETTINGS.apiBase, model: model.trim(), temperature: parsedTemperature, timeoutMs: parsedTimeout});
      await dependencies.setTtsPreferences(tts);
      savedKey.current = key; setApiKey(''); setSaved(true); onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '设置保存失败');
    } finally { setSaving(false); }
  };

  if (loading) {return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;}
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>设置</Text>
      <Text style={styles.sectionTitle}>DeepSeek</Text>
      <Text style={styles.label}>API Key</Text>
      <TextInput accessibilityLabel="DeepSeek API Key" value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" placeholder={savedKey.current ? '已安全保存，留空保持不变' : '输入 API Key'} style={styles.input} />
      <Text style={styles.label}>模型</Text>
      <TextInput accessibilityLabel="模型" value={model} onChangeText={setModel} autoCapitalize="none" style={styles.input} />
      <Text style={styles.label}>温度（0-2）</Text>
      <TextInput accessibilityLabel="温度" value={temperature} onChangeText={setTemperature} keyboardType="decimal-pad" style={styles.input} />
      <Text style={styles.label}>请求超时（毫秒）</Text>
      <TextInput accessibilityLabel="请求超时（毫秒）" value={timeout} onChangeText={setTimeoutValue} keyboardType="number-pad" style={styles.input} />

      <Text style={styles.sectionTitle}>语音</Text>
      <Text style={styles.label}>引擎</Text>
      <View style={styles.choices}><Choice label="离线中文" selected={tts.engine === 'offline'} onPress={() => setTts({...tts, engine: 'offline'})} /><Choice label="系统语音" selected={tts.engine === 'system'} onPress={() => setTts({...tts, engine: 'system'})} /></View>
      <Text style={styles.label}>中文音色</Text>
      <View style={styles.choices}><Choice label="中文女声" selected={tts.voice === 'zh-female'} onPress={() => setTts({...tts, voice: 'zh-female'})} /><Choice label="中文男声" selected={tts.voice === 'zh-male'} onPress={() => setTts({...tts, voice: 'zh-male'})} /></View>
      <Text style={styles.label}>语速</Text>
      <View style={styles.speedRow}><Pressable accessibilityLabel="语速降低" onPress={() => changeSpeed(-0.1)} style={styles.speedButton}><Text style={styles.speedButtonText}>−</Text></Pressable><Text style={styles.speed}>{tts.speed.toFixed(1)}×</Text><Pressable accessibilityLabel="语速增加" onPress={() => changeSpeed(0.1)} style={styles.speedButton}><Text style={styles.speedButtonText}>+</Text></Pressable></View>

      <View style={styles.disabled}><Text style={styles.disabledText}>语音预加载将在离线语音模块安装后可用</Text></View>
      <View style={styles.disabled}><Text style={styles.disabledText}>清理语音缓存将在离线语音模块安装后可用</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.success}>设置已保存</Text> : null}
      <Pressable disabled={saving} onPress={() => { save().catch(() => undefined); }} style={[styles.save, saving && styles.saveDisabled]}><Text style={styles.saveText}>{saving ? '正在保存' : '保存设置'}</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background}, content: {padding: 16, paddingBottom: 40}, center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 18}, sectionTitle: {fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 12},
  label: {fontSize: 13, color: colors.muted, marginBottom: 6}, input: {height: 46, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, fontSize: 15, color: colors.text, marginBottom: 13},
  choices: {flexDirection: 'row', gap: 8, marginBottom: 14}, choice: {flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface}, choiceSelected: {backgroundColor: colors.accentSoft, borderColor: colors.accent}, choiceText: {color: colors.muted}, choiceTextSelected: {color: colors.accent, fontWeight: '700'},
  speedRow: {height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 14}, speedButton: {width: 44, height: 44, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface}, speedButtonText: {fontSize: 24, color: colors.text}, speed: {width: 58, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text},
  disabled: {minHeight: 42, backgroundColor: '#ECECE8', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 8}, disabledText: {fontSize: 13, color: colors.muted},
  error: {color: colors.danger, marginVertical: 10}, success: {color: colors.accent, marginVertical: 10}, save: {height: 48, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 10}, saveDisabled: {opacity: 0.55}, saveText: {color: '#FFFFFF', fontWeight: '700'},
});
