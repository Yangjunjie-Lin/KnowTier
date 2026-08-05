import { BrowserRouter } from "react-router-dom";
import { AppQueryProvider } from "./QueryProvider";
import { AppRoutes } from "@/routes/AppRoutes";
import { AppProvider } from "@/stores/AppContext";

export default function App() {
  return (
    <AppQueryProvider>
      <AppProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProvider>
    </AppQueryProvider>
  );
}
