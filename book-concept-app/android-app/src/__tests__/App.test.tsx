import {render, screen} from '@testing-library/react-native';
import App from '../App';

test('shows the mobile library as the initial screen', () => {
  render(<App />);
  expect(screen.getByText('我的书库')).toBeTruthy();
});
