import React, {useEffect} from 'react';
import {SafeAreaView, StyleSheet, Text} from 'react-native';
import {openDatabase} from './data/database';

function App() {
  useEffect(() => {
    openDatabase().catch(() => undefined);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{'我的书库'}</Text>
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
});

export default App;
