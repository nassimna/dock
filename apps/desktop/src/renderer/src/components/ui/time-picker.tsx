import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TimePicker({ value, onChange, label, disabled }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [hour, minute] = value.split(":");
  return <div className="time-picker" role="group" aria-label={label}>
    <Select value={hour} onValueChange={hour => onChange(`${hour}:${minute}`)} disabled={disabled}>
      <SelectTrigger aria-label={`${label} hour`}><SelectValue /></SelectTrigger>
      <SelectContent position="popper">{Array.from({ length: 24 }, (_, hour) => {
        const value = String(hour).padStart(2, "0");
        return <SelectItem key={value} value={value}>{value}</SelectItem>;
      })}</SelectContent>
    </Select>
    <span aria-hidden="true">:</span>
    <Select value={minute} onValueChange={minute => onChange(`${hour}:${minute}`)} disabled={disabled}>
      <SelectTrigger aria-label={`${label} minute`}><SelectValue /></SelectTrigger>
      <SelectContent position="popper">{Array.from({ length: 60 }, (_, minute) => {
        const value = String(minute).padStart(2, "0");
        return <SelectItem key={value} value={value}>{value}</SelectItem>;
      })}</SelectContent>
    </Select>
  </div>;
}
