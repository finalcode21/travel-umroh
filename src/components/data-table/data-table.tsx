"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  render: (row: T) => React.ReactNode;
  /** plain text used for client-side search */
  searchValue?: (row: T) => string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  searchPlaceholder?: string;
  /** initial page size */
  pageSize?: number;
  /** renders per-row action buttons in the last column */
  rowActions?: (row: T) => React.ReactNode;
  /** extra toolbar content (filters, create button, …) */
  toolbar?: React.ReactNode;
  /** bulk action bar shown when rows are selected */
  bulkActions?: (selectedIds: string[], clear: () => void) => React.ReactNode;
  emptyMessage?: string;
  /** mobile rendering for a row (defaults to stacked key/value list) */
  mobileRender?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  searchPlaceholder = "Cari…",
  pageSize: initialPageSize = 10,
  rowActions,
  toolbar,
  bulkActions,
  emptyMessage = "Tidak ada data.",
  mobileRender,
  onRowClick,
  selectable = false,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const filtered = React.useMemo(() => {
    let result = rows;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter((row) =>
        columns.some((c) =>
          (c.searchValue?.(row) ?? "").toLowerCase().includes(q),
        ),
      );
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        result = [...result].sort((a, b) => {
          const av = col.searchValue?.(a) ?? "";
          const bv = col.searchValue?.(b) ?? "";
          const cmp = av.localeCompare(bv, "id", { numeric: true });
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [rows, query, columns, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(getRowId(r)));

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageRows.forEach((r) => next.delete(getRowId(r)));
      } else {
        pageRows.forEach((r) => next.add(getRowId(r)));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const colSpan = columns.length + (rowActions ? 1 : 0) + (selectable ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className="h-8 w-48 pl-8 sm:w-64"
          />
        </div>
        {toolbar}
      </div>

      {selectable && selected.size > 0 && bulkActions && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} dipilih</span>
          {bulkActions([...selected], () => setSelected(new Set()))}
        </div>
      )}

      {/* Desktop table */}
      <div className="erp-table hidden overflow-x-auto rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-9">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAllOnPage}
                    aria-label="Pilih semua"
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headerClassName}>
                  {col.sortable ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.header}
                      {sortKey === col.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((row) => {
              const id = getRowId(row);
              return (
                <TableRow
                  key={id}
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(id)}
                        onCheckedChange={() => toggleOne(id)}
                        aria-label="Pilih baris"
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                      {rowActions(row)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {pageRows.length === 0 && (
          <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        )}
        {pageRows.map((row) => {
          const id = getRowId(row);
          return (
            <div
              key={id}
              className={cn(
                "rounded-md border p-3",
                onRowClick && "cursor-pointer active:bg-accent",
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {mobileRender ? (
                mobileRender(row)
              ) : (
                <dl className="space-y-1.5">
                  {columns.slice(0, 4).map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <dt className="text-xs text-muted-foreground">{col.header}</dt>
                      <dd className="text-right text-sm">{col.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {rowActions && (
                <div className="mt-2 flex justify-end gap-1 border-t pt-2">
                  {rowActions(row)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {filtered.length === 0
            ? "0 data"
            : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} dari ${filtered.length}`}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 w-[70px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / hal
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-16 text-center text-xs">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
