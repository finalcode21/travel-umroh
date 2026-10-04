import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action";
import { moduleActionPermissions, type ModuleAction } from "@/core/modules/action-permissions";
import {
  deleteModuleData,
  installModule,
  saveModuleSettings,
  setModuleEnabled,
  subscribeModule,
  uninstallModule,
  upgradeModule,
} from "@/core/modules/engine";
import { moduleActionSchema, uninstallModuleSchema, saveModuleSettingsSchema, parseWith } from "@/lib/validation";
import { AppError, toPublicError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const LIFECYCLE_ACTIONS: ModuleAction[] = [
  "subscribe",
  "install",
  "enable",
  "disable",
  "upgrade",
  "uninstall",
  "configure",
  "deleteData",
];

/**
 * POST /api/modules/[code]/actions  body: { action, confirmDataLoss?, values? }
 * Single entry point for lifecycle operations over the REST surface.
 * Auth → tenant resolution → granular authorization → validation → engine
 * (PRD §35). Response contract = ActionResult (PRD §55).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      confirmDataLoss?: boolean;
      values?: Record<string, unknown>;
    };

    const action = body.action as ModuleAction | undefined;
    if (!action || !LIFECYCLE_ACTIONS.includes(action)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Action tidak dikenal. Gunakan salah satu dari: ${LIFECYCLE_ACTIONS.join(", ")}`,
      );
    }

    const result = await runAction(moduleActionPermissions(action), async (user) => {
      switch (action) {
        case "subscribe": {
          parseWith(moduleActionSchema, { moduleCode: code });
          await subscribeModule(user, code);
          return { moduleCode: code, action };
        }
        case "install": {
          parseWith(moduleActionSchema, { moduleCode: code });
          const installed = await installModule(user, code);
          return { ...installed, moduleCode: code, action };
        }
        case "upgrade": {
          parseWith(moduleActionSchema, { moduleCode: code });
          const upgraded = await upgradeModule(user, code);
          return { ...upgraded, moduleCode: code, action };
        }
        case "enable": {
          parseWith(moduleActionSchema, { moduleCode: code });
          await setModuleEnabled(user, code, true);
          return { moduleCode: code, action, status: "ACTIVE" };
        }
        case "disable": {
          parseWith(moduleActionSchema, { moduleCode: code });
          await setModuleEnabled(user, code, false);
          return { moduleCode: code, action, status: "DISABLED" };
        }
        case "uninstall": {
          const { confirmDataLoss } = parseWith(uninstallModuleSchema, {
            moduleCode: code,
            confirmDataLoss: body.confirmDataLoss,
          });
          return {
            ...(await uninstallModule(user, code, { confirmDataLoss })),
            moduleCode: code,
            action,
          };
        }
        case "configure": {
          const { values } = parseWith(saveModuleSettingsSchema, {
            moduleCode: code,
            values: body.values ?? {},
          });
          await saveModuleSettings(user, code, values);
          return { moduleCode: code, action, keys: Object.keys(values) };
        }
        case "deleteData": {
          parseWith(moduleActionSchema, { moduleCode: code });
          await deleteModuleData(user, code);
          return { moduleCode: code, action };
        }
      }
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const { code: errorCode, message, details } = toPublicError(e);
    return NextResponse.json(
      { ok: false, error: { code: errorCode, message, details } },
      { status: 500 },
    );
  }
}
