import { useEffect } from "react";

import { installBlueButtonHover } from "./blue-button-hover-controller";
import "./blue-button-hover.css";

export function BlueButtonHover() {
  useEffect(() => installBlueButtonHover(), []);
  return null;
}
