import React, {useCallback, useEffect, useState} from 'react';
import {Button, SafeAreaView, StyleSheet, Text} from 'react-native';
import {openDatabase} from './data/database';

function App() {
  const [initializationFailed, setInitializationFailed] = useState(false);
  const initializeDatabase = useCallback(() => {
    setInitializationFailed(false);
    openDatabase()
      .then(() => setInitializationFailed(false))
      .catch(() => setInitializationFailed(true));
  }, []);

  useEffect(() => {
    initializeDatabase();
  }, [initializeDatabase]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{'我的书库'}</Text>
      {initializationFailed ? (
        <>
          <Text style={styles.error}>数据库初始化失败</Text>
          <Button title="重试" onPress={initializeDatabase} />
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    marginBottom: 8,
  },
});

export default App;
