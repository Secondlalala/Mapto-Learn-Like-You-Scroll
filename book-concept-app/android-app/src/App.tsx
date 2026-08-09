import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View} from 'react-native';
import {openDatabase} from './data/database';
import {createRepositories, type Repositories} from './data/repositories';
import {generateNextSection, generateSection} from './deepseek/generator';
import {importBook, pickBookUri} from './import/importBook';
import {getDeepSeekSettings, setDeepSeekSettings} from './settings/secureSettings';
import {getTtsPreferences, setTtsPreferences} from './settings/ttsPreferences';
import AppNavigator, {type AppDependencies} from './ui/navigation/AppNavigator';
import {colors} from './ui/theme';

function createDependencies(repositories: Repositories): AppDependencies {
  return {
    repositories,
    pickBookUri,
    importBook,
    generateNextSection,
    generateSection,
    getDeepSeekSettings,
    setDeepSeekSettings,
    getTtsPreferences,
    setTtsPreferences,
  };
}

function App() {
  const [dependencies, setDependencies] = useState<AppDependencies | null>(null);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const initializeDatabase = useCallback(() => {
    setInitializationFailed(false);
    setDependencies(null);
    openDatabase()
      .then(database => setDependencies(createDependencies(createRepositories(database))))
      .catch(() => setInitializationFailed(true));
  }, []);

  useEffect(() => { initializeDatabase(); }, [initializeDatabase]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {initializationFailed ? (
        <View style={styles.center}>
          <Text style={styles.error}>本地数据库初始化失败</Text>
          <Pressable style={styles.retry} onPress={initializeDatabase}><Text style={styles.retryText}>重试</Text></Pressable>
        </View>
      ) : dependencies ? <AppNavigator dependencies={dependencies} /> : <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.loading}>正在打开本地书库</Text></View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: colors.background}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  loading: {color: colors.muted, marginTop: 10}, error: {color: colors.danger, fontSize: 16, marginBottom: 14},
  retry: {height: 44, paddingHorizontal: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center'}, retryText: {color: '#FFFFFF', fontWeight: '700'},
});

export default App;
