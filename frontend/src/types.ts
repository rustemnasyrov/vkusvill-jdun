export type ShiftSlot = {
  id: string;
  location_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  courier_type: "teal" | "blue" | "amber" | "purple";
  booked_count: number;
  closed_by_admin: boolean;
};

export type LocationDto = {
  id: string;
  name: string;
  timezone: string;
};

export type ShiftTemplateDto = {
  id: string;
  location_id: string;
  day_of_week: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  courier_type: "teal" | "blue" | "amber" | "purple";
  is_active: boolean;
};

export type CourierDto = {
  id: string;
  external_ref: string | null;
  full_name: string;
  phone: string | null;
  courier_type: "teal" | "blue" | "amber" | "purple";
  status: string;
  location_ids: string[];
};

export type AssignmentDto = {
  id: string;
  courier_id: string;
  shift_instance_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
};
