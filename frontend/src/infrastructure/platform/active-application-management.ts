import path from 'node:path';
import type { ObservationApplication, ObservationPolicy } from '../../application/ports/active-application-observation.port';
import { safeObservationText, type ObservationExecutable } from './active-application-protocol';

/** Canonical executable paths are held only in this Infrastructure-owned RAM registry. */
export class ObservationExecutableRegistry {
  private readonly applications = new Map<string, { readonly path: string; readonly application: ObservationApplication }>();
  public constructor(private readonly canonicalize: (filename: string) => string, private readonly uuid: () => string) {}
  public registerExecutable(filename: string): ObservationApplication {
    if (!path.win32.isAbsolute(filename) || filename.length > 1024 || /[\u0000-\u001f]/u.test(filename)) throw new Error('Invalid executable');
    let canonical = this.canonicalize(filename);
    if (canonical.startsWith('\\\\?\\UNC\\')) canonical = `\\\\${canonical.slice(8)}`;
    else if (canonical.startsWith('\\\\?\\')) canonical = canonical.slice(4);
    if (!path.win32.isAbsolute(canonical) || canonical.length > 1024 || path.win32.extname(canonical).toLowerCase() !== '.exe') {
      throw new Error('Invalid executable');
    }
    for (const entry of this.applications.values()) if (entry.path.toLowerCase() === canonical.toLowerCase()) return entry.application;
    if (this.applications.size >= 32) throw new Error('Observation application limit');
    const alias = safeObservationText(path.win32.basename(canonical).slice(0, -4), 80);
    if (!alias) throw new Error('Invalid executable');
    const application: ObservationApplication = Object.freeze({ appKey: this.uuid(), alias, category: 'unknown', excluded: false });
    this.applications.set(application.appKey, { path: canonical, application });
    return application;
  }
  public forgetExecutable(appKey: string): void { this.applications.delete(appKey); }
  public clearExecutables(): void { this.applications.clear(); }
  public resolvePolicy(policy: ObservationPolicy): readonly ObservationExecutable[] {
    if (policy.applications.length > 32 || new Set(policy.applications.map(entry => entry.appKey)).size !== policy.applications.length) {
      throw new Error('Invalid observation policy');
    }
    return policy.applications.map(application => {
      const entry = this.applications.get(application.appKey);
      if (!entry || !['editor', 'other', 'unknown'].includes(application.category) || typeof application.excluded !== 'boolean') {
        throw new Error('Invalid observation policy');
      }
      return Object.freeze({ appKey: application.appKey, path: entry.path, excluded: application.excluded, category: application.category });
    });
  }
}
