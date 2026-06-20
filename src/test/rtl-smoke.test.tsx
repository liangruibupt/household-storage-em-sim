import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// 冒烟测试：验证 React Testing Library + jsdom + @testing-library/jest-dom
// 以及 JSX/TSX 编译链路均配置正确。
describe("react testing library smoke", () => {
  it("renders a component and queries the DOM", () => {
    render(<button type="button">在线</button>);
    expect(screen.getByRole("button", { name: "在线" })).toBeInTheDocument();
  });
});
