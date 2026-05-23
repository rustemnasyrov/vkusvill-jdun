import AdminSchedule from "./AdminSchedule";
import CourierSelfSignup from "./CourierSelfSignup";

export default function App() {
  if (window.location.pathname.startsWith("/courier")) {
    return <CourierSelfSignup />;
  }
  return <AdminSchedule />;
}
