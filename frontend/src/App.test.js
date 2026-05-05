import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders team task auth screen', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', {
      name: /project work, roles, and progress in one place/i,
    })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
});
