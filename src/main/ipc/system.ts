import { ipcMain, app } from 'electron';

/**
 * System metrics — RAM/CPU/process count pra widget na statusbar.
 *
 * Strategy:
 *   - RAM total: soma working set (kB) de TODOS os processes do app via app.getAppMetrics()
 *     -> mais preciso que só `process.getProcessMemoryInfo()` do main (pega só este processo).
 *   - CPU%: soma percentCPUUsage de todos processes. Cap em 100 (multi-core pode passar).
 *   - processes: app.getAppMetrics().length
 *
 * Custo: getAppMetrics() é sync e barato; polling de 2s é tranquilo.
 */

export interface SystemMetrics {
  rssMb: number;
  cpuPercent: number;
  processes: number;
}

export function registerSystemIPC(): void {
  ipcMain.handle('system:metrics', async (): Promise<SystemMetrics> => {
    try {
      const metrics = app.getAppMetrics();
      let totalKb = 0;
      let totalCpu = 0;
      for (const m of metrics) {
        // memory.workingSetSize está em kB no Electron
        totalKb += m.memory?.workingSetSize ?? 0;
        totalCpu += m.cpu?.percentCPUUsage ?? 0;
      }
      const rssMb = Math.round(totalKb / 1024);
      const cpuPercent = Math.min(100, Math.round(totalCpu));
      return {
        rssMb,
        cpuPercent,
        processes: metrics.length,
      };
    } catch {
      return { rssMb: 0, cpuPercent: 0, processes: 0 };
    }
  });
}
