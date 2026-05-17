import { execSync } from 'child_process';

export function getDockerStatus(agentName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const containerName = agentName.toLowerCase().replace(/\s+/g, '-');
      const result = execSync(
        `docker inspect --format='{{.State.Status}}' ${containerName}`,
        { stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString().trim().replace(/'/g, '');
      resolve(result || 'unknown');
    } catch {
      resolve('not found');
    }
  });
}

export function getDockerStats(agentName: string): Promise<{ cpu: string; memory: string }> {
  return new Promise((resolve, reject) => {
    try {
      const containerName = agentName.toLowerCase().replace(/\s+/g, '-');
      const result = execSync(
        `docker stats ${containerName} --no-stream --format "{{.CPUPerc}} {{.MemUsage}}"`,
        { stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString().trim();
      const [cpu, ...memParts] = result.split(' ');
      resolve({ cpu, memory: memParts.join(' ') });
    } catch {
      reject(new Error('Could not get stats'));
    }
  });
}

export function buildDockerImage(imageName: string, contextPath: string): void {
  execSync(`docker build -t ${imageName} ${contextPath}`, { stdio: 'inherit' });
}

export function runDockerContainer(
  imageName: string,
  containerName: string,
  port: string,
  envFile: string
): void {
  execSync(
    `docker run -d --name ${containerName} -p ${port}:${port} --env-file ${envFile} ${imageName}`,
    { stdio: 'inherit' }
  );
}
