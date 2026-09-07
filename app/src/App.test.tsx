import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the dashboard shell", () => {
  render(<App />);
  expect(screen.getByText("Energy dashboard")).toBeInTheDocument();
});
