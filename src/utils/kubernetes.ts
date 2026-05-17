import { execSync } from 'child_process';
import * as fs from 'fs';

export function isKubernetesAvailable(): boolean {
  try {
    execSync('kubectl cluster-info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function applyManifest(yamlPath: string): void {
  execSync(`kubectl apply -f ${yamlPath}`, { stdio: 'inherit' });
}

export function deleteDeployment(name: string): void {
  execSync(`kubectl delete deployment ${name} --ignore-not-found`, { stdio: 'inherit' });
}

export function getDeploymentStatus(name: string): string {
  try {
    const result = execSync(
      `kubectl get deployment ${name} -o jsonpath='{.status.availableReplicas}'`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
    return result || '0';
  } catch {
    return 'unknown';
  }
}

export function scaleDeploy(name: string, replicas: number): void {
  execSync(`kubectl scale deployment ${name} --replicas=${replicas}`, { stdio: 'inherit' });
}
