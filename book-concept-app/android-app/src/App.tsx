import {SafeAreaView, StyleSheet, Text} from 'react-native';

function App() {
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
