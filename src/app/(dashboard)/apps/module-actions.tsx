"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ActionResult } from "@/types";
import type { ModuleAccess } from "@/types";
import {
  deleteModuleDataAction,
  disableModuleAction,
  enableModuleAction,
  installModuleAction,
  subscribeModuleAction,
  uninstallModuleAction,
} from "./actions";

async function run<T>(
  promise: Promise<ActionResult<T>>,
  messages: { success: string; errorPrefix: string },
): Promise<boolean> {
  const result = await promise;
  if (result.ok) {
    toast.success(messages.success);
    return true;
  }
  toast.error(`${messages.errorPrefix}: ${result.error.message}`);
  return false;
}

/** Contextual action set for a module card, based on effective access state. */
export function ModuleActions({
  moduleCode,
  moduleName,
  access,
  size = "sm",
}: {
  moduleCode: string;
  moduleName: string;
  access: ModuleAccess;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const refresh = () => router.refresh();

  const wrap = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    const ok = await fn();
    setBusy(null);
    if (ok) refresh();
  };

  const buttons: React.ReactNode[] = [];

  if (access.access === "NOT_SUBSCRIBED") {
    buttons.push(
      <Button
        key="subscribe"
        size={size}
        disabled={busy !== null}
        onClick={() =>
          wrap("subscribe", () =>
            run(subscribeModuleAction({ moduleCode }), {
              success: `Langganan trial ${moduleName} dibuat`,
              errorPrefix: "Gagal subscribe",
            }),
          )
        }
      >
        {busy === "subscribe" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Subscribe
      </Button>,
    );
  }

  if (access.access === "SUBSCRIBED") {
    buttons.push(
      <Button
        key="install"
        size={size}
        disabled={busy !== null}
        onClick={() =>
          wrap("install", () =>
            run(installModuleAction({ moduleCode }), {
              success: `${moduleName} berhasil di-install`,
              errorPrefix: "Instalasi gagal",
            }),
          )
        }
      >
        {busy === "install" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Install
      </Button>,
    );
  }

  if (access.access === "ACTIVE") {
    buttons.push(
      <Button
        key="disable"
        size={size}
        variant="outline"
        disabled={busy !== null}
        onClick={() =>
          wrap("disable", () =>
            run(disableModuleAction({ moduleCode }), {
              success: `${moduleName} di-disable — navigasi disembunyikan, data tetap ada`,
              errorPrefix: "Gagal disable",
            }),
          )
        }
      >
        Disable
      </Button>,
    );
  }

  if (access.access === "DISABLED" || access.access === "UNINSTALLED") {
    if (access.access === "DISABLED") {
      buttons.push(
        <Button
          key="enable"
          size={size}
          disabled={busy !== null}
          onClick={() =>
            wrap("enable", () =>
              run(enableModuleAction({ moduleCode }), {
                success: `${moduleName} di-enable kembali`,
                errorPrefix: "Gagal enable",
              }),
            )
          }
        >
          Enable
        </Button>,
      );
    } else {
      // UNINSTALLED but subscription still valid → install again
      buttons.push(
        <Button
          key="reinstall"
          size={size}
          disabled={busy !== null}
          onClick={() =>
            wrap("install", () =>
              run(installModuleAction({ moduleCode }), {
                success: `${moduleName} berhasil di-install kembali`,
                errorPrefix: "Instalasi gagal",
              }),
            )
          }
        >
          Install
        </Button>,
      );
    }
  }

  const canUninstall =
    access.access === "ACTIVE" || access.access === "DISABLED" || access.access === "PAUSED";

  if (canUninstall) {
    buttons.push(
      <AlertDialog key="uninstall">
        <AlertDialogTrigger asChild>
          <Button size={size} variant="ghost" className="text-destructive" disabled={busy !== null}>
            Uninstall
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {moduleName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Navigasi dan akses modul dihilangkan. <strong>Data bisnis tetap
              disimpan</strong> — penghapusan data adalah aksi terpisah dan
              memerlukan konfirmasi tambahan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setBusy("uninstall");
                await run(uninstallModuleAction({ moduleCode }), {
                  success: `${moduleName} di-uninstall (data dipertahankan)`,
                  errorPrefix: "Uninstall ditolak",
                });
                setBusy(null);
                refresh();
              }}
            >
              Ya, uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
  }

  if (access.access === "PAUSED") {
    buttons.push(
      <Button key="paused" size={size} variant="secondary" disabled>
        Langganan berakhir — perpanjang di Subscriptions
      </Button>,
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {buttons}
      {busy !== null && busy !== "subscribe" && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/** Danger zone: delete all module business data (separate from uninstall). */
export function DeleteModuleDataButton({
  moduleCode,
  moduleName,
}: {
  moduleCode: string;
  moduleName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Hapus Data Modul
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus SEMUA data {moduleName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Aksi ini <strong>tidak dapat dibatalkan</strong>. Seluruh data bisnis
            modul ini untuk perusahaan Anda akan dihapus permanen. Disarankan
            backup database terlebih dahulu. Aksi tercatat di audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              setBusy(true);
              const result = await deleteModuleDataAction({ moduleCode });
              setBusy(false);
              if (result.ok) {
                toast.success(`Data ${moduleName} dihapus`);
                router.refresh();
              } else {
                toast.error(`Gagal: ${result.error.message}`);
              }
            }}
          >
            Saya mengerti, hapus permanen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConfigureButton({ href }: { href: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={href}>
        <Settings2 className="mr-1 h-3.5 w-3.5" /> Configure
      </a>
    </Button>
  );
}
