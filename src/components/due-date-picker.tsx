import { CalendarIcon, Clock3 } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DueDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

export function DueDatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick due date",
}: DueDatePickerProps) {
  const selected = parseLocalDateTime(value);
  const timeValue = selected ? format(selected, "HH:mm") : "";

  const setDate = (date?: Date) => {
    if (!date) return;
    const current = selected ?? new Date();
    const next = new Date(date);
    next.setHours(
      selected ? current.getHours() : 9,
      selected ? current.getMinutes() : 0,
      0,
      0,
    );
    onChange(format(next, "yyyy-MM-dd'T'HH:mm"));
  };

  const setTime = (time: string) => {
    const [hours = "9", minutes = "0"] = time.split(":");
    const next = selected ?? new Date();
    next.setHours(Number(hours), Number(minutes), 0, 0);
    onChange(format(next, "yyyy-MM-dd'T'HH:mm"));
  };

  return (
    <div
      className={cn(
        "grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem]",
        className,
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "justify-start px-3 text-left font-medium",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setDate}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <div className="relative">
        <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Due time"
          className="pl-9"
          type="time"
          value={timeValue}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
    </div>
  );
}

function parseLocalDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
