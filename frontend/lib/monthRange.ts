export function orderedMonthRange(
  startYear: number, startMonth: number, endYear: number, endMonth: number,
  edge: "start" | "end", year: number, month: number,
) {
  if (edge === "start") {
    startYear=year; startMonth=month;
    if (year*12+month > endYear*12+endMonth) { endYear=year; endMonth=month; }
  } else {
    endYear=year; endMonth=month;
    if (year*12+month < startYear*12+startMonth) { startYear=year; startMonth=month; }
  }
  return {startYear,startMonth,endYear,endMonth};
}
