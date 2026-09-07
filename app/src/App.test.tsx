import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the dashboard shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: "Marburg Energy" })).toBeInTheDocument();
});
