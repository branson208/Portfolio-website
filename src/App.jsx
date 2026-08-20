import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PrintPage from "./pages/PrintPage";
import { CursorProvider } from "./lib/cursor";
import { AboutProvider } from "./components/AboutOverlay";

export default function App() {
  return (
    <CursorProvider>
      <AboutProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/print" element={<PrintPage />} />
          <Route path="/save-pdf" element={<Navigate to="/print" replace />} />
          <Route path="/:slug" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AboutProvider>
    </CursorProvider>
  );
}
