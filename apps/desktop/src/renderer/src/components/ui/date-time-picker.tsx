import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { dateTimeInput } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";

export function DateTimePicker({ value, onChange, label }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : "09:00";
  function select(day: Date, time: string) {
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(day);
    next.setHours(hour!, minute!, 0, 0);
    onChange(dateTimeInput(next.toISOString()));
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" className="date-time-trigger" aria-label={label}>
        <CalendarDays size={15} />
        {date ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${time}` : "Choose date and time"}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="date-time-popover" aria-label={`${label} picker`}>
      <Calendar mode="single" selected={date} defaultMonth={date} onSelect={day => { if (day) select(day, time); }} />
      <div className="date-time-clock"><span>Time</span><TimePicker label={`${label} time`} value={time} onChange={time => select(date ?? new Date(), time)} /></div>
      <div className="date-time-actions">
        <Button type="button" variant="ghost" size="sm" onClick={() => select(new Date(), time)}>Today</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>Clear</Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
