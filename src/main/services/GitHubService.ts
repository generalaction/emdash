import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { shell } from 'electron';
import { GITHUB_OAUTH_CONFIG } from '../config/github.config';

const execAsync = promisify(exec);

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  updatedAt?: string | null;
  headRefOid?: string;
  author?: {
    login?: string;
    name?: string;
  } | null;
  headRepositoryOwner?: {
    login?: string;
  } | null;
  headRepository?: {
    name?: string;
    nameWithOwner?: string;
    url?: string;
  } | null;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: GitHubUser;
  error?: string;
}

export class GitHubService {
  private readonly SERVICE_NAME = 'emdash-github';
  private readonly ACCOUNT_NAME = 'github-token';

  /**
   * Authenticate with GitHub using OAuth (opens browser)
   */
  async authenticate(): Promise<AuthResult> {
    // Use OAuth flow instead of checking gh auth status
    return await this.authenticateWithOAuth();
  }

  /**
   * Authenticate with GitHub using OAuth (opens browser)
   */
  async authenticateWithOAuth(): Promise<AuthResult> {
    // Check if OAuth credentials are configured
    if (
      !GITHUB_OAUTH_CONFIG.clientId ||
      GITHUB_OAUTH_CONFIG.clientId === 'YOUR_CLIENT_ID_HERE' ||
      !GITHUB_OAUTH_CONFIG.clientSecret ||
      GITHUB_OAUTH_CONFIG.clientSecret === 'YOUR_CLIENT_SECRET_HERE'
    ) {
      return {
        success: false,
        error:
          'GitHub OAuth not configured.\n\n' +
          'Please:\n' +
          '1. Register an OAuth app at https://github.com/settings/developers\n' +
          '2. Set callback URL to: http://localhost:8888/callback\n' +
          '3. Add credentials to .env file:\n' +
          '   GITHUB_CLIENT_ID=your_client_id\n' +
          '   GITHUB_CLIENT_SECRET=your_secret',
      };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const server = http.createServer(async (req, res) => {
        if (resolved) return; // Prevent double resolution

        try {
          const url = new URL(req.url!, `http://localhost:${GITHUB_OAUTH_CONFIG.callbackPort}`);
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed - emdash</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px 32px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    .error-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #1f2937;
    }
    p {
      font-size: 16px;
      color: #6b7280;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">✕</div>
    <h1>Authentication Failed</h1>
    <p>You can close this window and try again.</p>
  </div>
</body>
</html>
            `);
            resolved = true;
            server.close();
            resolve({ success: false, error: 'User denied access' });
            return;
          }

          if (code) {
            // Exchange code for token
            const tokenResult = await this.exchangeCodeForToken(code);

            if (tokenResult.success && tokenResult.token) {
              // Store token in keytar
              await this.storeToken(tokenResult.token);

              // Authenticate gh CLI with the same token
              await this.authenticateGHCLI(tokenResult.token);

              // Get user info
              const user = await this.getUserInfo(tokenResult.token);

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Success - emdash</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background-color: hsl(215, 28%, 17%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      color: hsl(220, 9%, 96%);
    }
    .container {
      text-align: center;
      max-width: 400px;
    }
    .logo {
      width: 120px;
      height: auto;
      margin: 0 auto 32px;
      opacity: 0.95;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      stroke: white;
      stroke-width: 3;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: hsl(220, 9%, 96%);
    }
    p {
      font-size: 16px;
      color: hsl(220, 9%, 70%);
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 177 47" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M49.071 35.3835C47.1023 35.3835 45.402 34.9744 43.9702 34.1562C42.5469 33.3295 41.4517 32.1619 40.6847 30.6534C39.9176 29.1364 39.5341 27.3509 39.5341 25.2969C39.5341 23.277 39.9176 21.5043 40.6847 19.9787C41.4602 18.4446 42.5426 17.2514 43.9318 16.3991C45.321 15.5384 46.9531 15.108 48.8281 15.108C50.0384 15.108 51.1804 15.304 52.2543 15.696C53.3366 16.0795 54.2912 16.6761 55.1179 17.4858C55.9531 18.2955 56.6094 19.3267 57.0866 20.5795C57.5639 21.8239 57.8026 23.3068 57.8026 25.0284V26.4474H41.7074V23.3281H53.3665C53.358 22.4418 53.1662 21.6534 52.7912 20.9631C52.4162 20.2642 51.892 19.7145 51.2188 19.3139C50.554 18.9134 49.7784 18.7131 48.892 18.7131C47.946 18.7131 47.1151 18.9432 46.3991 19.4034C45.6832 19.8551 45.125 20.4517 44.7244 21.1932C44.3324 21.9261 44.1321 22.7315 44.1236 23.6094V26.3324C44.1236 27.4744 44.3324 28.4545 44.75 29.2727C45.1676 30.0824 45.7514 30.7045 46.5014 31.1392C47.2514 31.5653 48.1293 31.7784 49.1349 31.7784C49.8082 31.7784 50.4176 31.6847 50.9631 31.4972C51.5085 31.3011 51.9815 31.0156 52.3821 30.6406C52.7827 30.2656 53.0852 29.8011 53.2898 29.2472L57.6108 29.733C57.3381 30.875 56.8182 31.8722 56.0511 32.7244C55.2926 33.5682 54.321 34.2244 53.1364 34.6932C51.9517 35.1534 50.5966 35.3835 49.071 35.3835ZM61.7177 35V15.3636H66.141V18.7003H66.3711C66.7802 17.5753 67.4577 16.6974 68.4038 16.0668C69.3498 15.4276 70.479 15.108 71.7915 15.108C73.1211 15.108 74.2418 15.4318 75.1538 16.0795C76.0742 16.7187 76.7219 17.5923 77.0969 18.7003H77.3015C77.7362 17.6094 78.4691 16.7401 79.5004 16.0923C80.5401 15.4361 81.7717 15.108 83.195 15.108C85.0018 15.108 86.4762 15.679 87.6183 16.821C88.7603 17.9631 89.3313 19.6293 89.3313 21.8196V35H84.6907V22.5355C84.6907 21.3168 84.3668 20.4261 83.7191 19.8636C83.0714 19.2926 82.2788 19.0071 81.3413 19.0071C80.2248 19.0071 79.3512 19.3565 78.7205 20.0554C78.0984 20.7457 77.7873 21.6449 77.7873 22.7528V35H73.2489V22.3438C73.2489 21.3295 72.9421 20.5199 72.3285 19.9148C71.7234 19.3097 70.9308 19.0071 69.9506 19.0071C69.2859 19.0071 68.6808 19.1776 68.1353 19.5185C67.5898 19.8509 67.1552 20.3239 66.8313 20.9375C66.5075 21.5426 66.3455 22.25 66.3455 23.0597V35H61.7177ZM101.313 35.3452C99.7706 35.3452 98.3899 34.9489 97.1712 34.1562C95.9524 33.3636 94.9893 32.2131 94.282 30.7045C93.5746 29.196 93.2209 27.3636 93.2209 25.2074C93.2209 23.0256 93.5788 21.1847 94.2947 19.6847C95.0192 18.1761 95.995 17.0384 97.2223 16.2713C98.4496 15.4957 99.8175 15.108 101.326 15.108C102.477 15.108 103.423 15.304 104.164 15.696C104.906 16.0795 105.494 16.544 105.928 17.0895C106.363 17.6264 106.7 18.1335 106.938 18.6108H107.13V8.81818H111.771V35H107.219V31.9062H106.938C106.7 32.3835 106.354 32.8906 105.903 33.4276C105.451 33.956 104.854 34.4077 104.113 34.7827C103.371 35.1577 102.438 35.3452 101.313 35.3452ZM102.604 31.5483C103.585 31.5483 104.42 31.2841 105.11 30.7557C105.8 30.2187 106.325 29.473 106.683 28.5185C107.04 27.5639 107.219 26.4517 107.219 25.1818C107.219 23.9119 107.04 22.8082 106.683 21.8707C106.333 20.9332 105.813 20.2045 105.123 19.6847C104.441 19.1648 103.602 18.9048 102.604 18.9048C101.573 18.9048 100.712 19.1733 100.022 19.7102C99.3317 20.2472 98.8118 20.9886 98.4624 21.9347C98.1129 22.8807 97.9382 23.9631 97.9382 25.1818C97.9382 26.4091 98.1129 27.5043 98.4624 28.4673C98.8203 29.4219 99.3445 30.1761 100.035 30.7301C100.734 31.2756 101.59 31.5483 102.604 31.5483ZM122.353 35.3963C121.108 35.3963 119.988 35.1747 118.99 34.7315C118.002 34.2798 117.218 33.6151 116.638 32.7372C116.067 31.8594 115.782 30.777 115.782 29.4901C115.782 28.3821 115.986 27.4659 116.395 26.7415C116.804 26.017 117.363 25.4375 118.07 25.0028C118.777 24.5682 119.574 24.2401 120.461 24.0185C121.355 23.7884 122.28 23.6222 123.235 23.5199C124.385 23.4006 125.319 23.294 126.034 23.2003C126.75 23.098 127.27 22.9446 127.594 22.7401C127.926 22.527 128.093 22.1989 128.093 21.7557V21.679C128.093 20.7159 127.807 19.9702 127.236 19.4418C126.665 18.9134 125.843 18.6491 124.769 18.6491C123.635 18.6491 122.736 18.8963 122.071 19.3906C121.415 19.8849 120.972 20.4687 120.742 21.142L116.421 20.5284C116.762 19.3352 117.324 18.3381 118.108 17.5369C118.892 16.7273 119.851 16.1222 120.985 15.7216C122.118 15.3125 123.371 15.108 124.743 15.108C125.689 15.108 126.631 15.2188 127.569 15.4403C128.506 15.6619 129.363 16.0284 130.138 16.5398C130.914 17.0426 131.536 17.7287 132.005 18.598C132.482 19.4673 132.721 20.554 132.721 21.858V35H128.272V32.3026H128.118C127.837 32.848 127.441 33.3594 126.929 33.8366C126.426 34.3054 125.792 34.6847 125.025 34.9744C124.266 35.2557 123.375 35.3963 122.353 35.3963ZM123.554 31.9957C124.483 31.9957 125.289 31.8125 125.971 31.446C126.652 31.071 127.176 30.5767 127.543 29.9631C127.918 29.3494 128.105 28.6804 128.105 27.956V25.642C127.961 25.7614 127.713 25.8722 127.364 25.9744C127.023 26.0767 126.64 26.1662 126.213 26.2429C125.787 26.3196 125.365 26.3878 124.948 26.4474C124.53 26.5071 124.168 26.5582 123.861 26.6009C123.171 26.6946 122.553 26.848 122.007 27.0611C121.462 27.2741 121.032 27.5724 120.716 27.956C120.401 28.331 120.243 28.8168 120.243 29.4134C120.243 30.2656 120.554 30.9091 121.176 31.3438C121.799 31.7784 122.591 31.9957 123.554 31.9957ZM152.894 20.554L148.675 21.0142C148.556 20.5881 148.347 20.1875 148.049 19.8125C147.759 19.4375 147.367 19.1349 146.873 18.9048C146.378 18.6747 145.773 18.5597 145.057 18.5597C144.094 18.5597 143.284 18.7685 142.628 19.1861C141.98 19.6037 141.661 20.1449 141.669 20.8097C141.661 21.3807 141.87 21.8452 142.296 22.2031C142.73 22.5611 143.446 22.8551 144.444 23.0852L147.793 23.8011C149.651 24.2017 151.032 24.8366 151.935 25.706C152.847 26.5753 153.307 27.7131 153.316 29.1193C153.307 30.3551 152.945 31.446 152.229 32.392C151.522 33.3295 150.537 34.0625 149.276 34.5909C148.015 35.1193 146.566 35.3835 144.929 35.3835C142.526 35.3835 140.591 34.8807 139.125 33.875C137.659 32.8608 136.786 31.4503 136.505 29.6435L141.017 29.2088C141.222 30.0952 141.657 30.7642 142.321 31.2159C142.986 31.6676 143.851 31.8935 144.917 31.8935C146.016 31.8935 146.898 31.6676 147.563 31.2159C148.236 30.7642 148.573 30.206 148.573 29.5412C148.573 28.9787 148.355 28.5142 147.921 28.1477C147.495 27.7812 146.83 27.5 145.926 27.304L142.577 26.6009C140.694 26.2088 139.3 25.5483 138.397 24.6193C137.493 23.6818 137.046 22.4972 137.054 21.0653C137.046 19.8551 137.374 18.8068 138.039 17.9205C138.712 17.0256 139.645 16.3352 140.838 15.8494C142.04 15.3551 143.425 15.108 144.993 15.108C147.294 15.108 149.105 15.598 150.426 16.5781C151.756 17.5582 152.578 18.8835 152.894 20.554ZM161.76 23.4943V35H157.132V8.81818H161.657V18.7003H161.887C162.348 17.5923 163.059 16.7187 164.022 16.0795C164.994 15.4318 166.23 15.108 167.73 15.108C169.093 15.108 170.282 15.3935 171.297 15.9645C172.311 16.5355 173.095 17.3707 173.649 18.4702C174.211 19.5696 174.493 20.9119 174.493 22.4972V35H169.865V23.2131C169.865 21.892 169.524 20.8651 168.842 20.1321C168.169 19.3906 167.223 19.0199 166.004 19.0199C165.186 19.0199 164.453 19.1989 163.805 19.5568C163.166 19.9062 162.663 20.4134 162.297 21.0781C161.939 21.7429 161.76 22.5483 161.76 23.4943Z" fill="white"/>
      <path d="M0 24H30V28H0V24Z" fill="white"/>
    </svg>
    <div class="success-icon">
      <svg viewBox="0 0 24 24">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <h1>Success</h1>
    <p>Return back to emdash</p>
  </div>
</body>
</html>
              `);
              resolved = true;
              server.close();
              resolve({ success: true, token: tokenResult.token, user: user || undefined });
            } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed - emdash</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px 32px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    .error-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #1f2937;
    }
    p {
      font-size: 16px;
      color: #6b7280;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">✕</div>
    <h1>Authentication Failed</h1>
    <p>You can close this window and try again.</p>
  </div>
</body>
</html>
            `);
              resolved = true;
              server.close();
              resolve({ success: false, error: tokenResult.error || 'Failed to get token' });
            }
          }
        } catch (error) {
          console.error('OAuth callback error:', error);
          if (!resolved) {
            try {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - emdash</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px 32px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    .error-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #1f2937;
    }
    p {
      font-size: 16px;
      color: #6b7280;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">!</div>
    <h1>Something Went Wrong</h1>
    <p>Please close this window and try again.</p>
  </div>
</body>
</html>
          `);
            } catch {}
            resolved = true;
            server.close();
            resolve({ success: false, error: 'OAuth flow failed' });
          }
        }
      });

      // Handle server errors (like port already in use)
      server.on('error', (err: any) => {
        if (!resolved) {
          resolved = true;
          if (err.code === 'EADDRINUSE') {
            resolve({
              success: false,
              error: `Port ${GITHUB_OAUTH_CONFIG.callbackPort} is already in use. Please wait a moment and try again.`,
            });
          } else {
            resolve({
              success: false,
              error: `Server error: ${err.message}`,
            });
          }
        }
      });

      server.listen(GITHUB_OAUTH_CONFIG.callbackPort, () => {
        // Open browser to GitHub OAuth page
        const authUrl =
          `https://github.com/login/oauth/authorize?` +
          `client_id=${GITHUB_OAUTH_CONFIG.clientId}&` +
          `scope=${GITHUB_OAUTH_CONFIG.scopes.join(' ')}&` +
          `redirect_uri=${GITHUB_OAUTH_CONFIG.redirectUri}`;

        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          server.close();
          resolve({ success: false, error: 'Authentication timeout (5 minutes)' });
        }
      }, 300000);

      // Clean up timeout when server closes
      server.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Exchange OAuth code for access token
   */
  private async exchangeCodeForToken(
    code: string
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_OAUTH_CONFIG.clientId,
          client_secret: GITHUB_OAUTH_CONFIG.clientSecret,
          code: code,
          redirect_uri: GITHUB_OAUTH_CONFIG.redirectUri,
        }),
      });

      const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (data.access_token) {
        return { success: true, token: data.access_token };
      } else {
        return { success: false, error: data.error_description || 'Failed to get token' };
      }
    } catch (error) {
      console.error('Token exchange failed:', error);
      return { success: false, error: 'Network error during token exchange' };
    }
  }

  /**
   * Authenticate gh CLI with the OAuth token
   */
  private async authenticateGHCLI(token: string): Promise<void> {
      try {
      // Check if gh CLI is installed first
        await execAsync('gh --version');

      // Authenticate gh CLI with our token
      await execAsync(`echo "${token}" | gh auth login --with-token`);
      console.log('Successfully authenticated gh CLI');
    } catch (error) {
      console.warn('Could not authenticate gh CLI (may not be installed):', error);
      // Don't throw - OAuth still succeeded even if gh CLI isn't available
    }
  }

  /**
   * Execute gh command with automatic re-auth on failure
   */
  private async execGH(
    command: string,
    options?: any
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execAsync(command, { encoding: 'utf8', ...options });
        return {
        stdout: String(result.stdout),
        stderr: String(result.stderr),
      };
    } catch (error: any) {
      // Check if it's an auth error
      if (error.message && error.message.includes('not authenticated')) {
        console.log('gh CLI lost authentication, re-authenticating...');

        // Try to re-authenticate gh CLI with stored token
        const token = await this.getStoredToken();
        if (token) {
          await this.authenticateGHCLI(token);

          // Retry the command
          const result = await execAsync(command, { encoding: 'utf8', ...options });
        return {
            stdout: String(result.stdout),
            stderr: String(result.stderr),
        };
        }
      }
      throw error;
    }
  }

  /**
   * List open GitHub issues for the current repo (cwd = projectPath)
   */
  async listIssues(
    projectPath: string,
    limit: number = 50
  ): Promise<
    Array<{
      number: number;
      title: string;
      url?: string;
      state?: string;
      updatedAt?: string | null;
      assignees?: Array<{ login?: string; name?: string }>;
      labels?: Array<{ name?: string }>;
    }>
  > {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    try {
      const fields = ['number', 'title', 'url', 'state', 'updatedAt', 'assignees', 'labels'];
      const { stdout } = await this.execGH(
        `gh issue list --state open --limit ${safeLimit} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const list = JSON.parse(stdout || '[]');
      if (!Array.isArray(list)) return [];
      return list;
    } catch (error) {
      console.error('Failed to list GitHub issues:', error);
      throw error;
    }
  }

  /** Search open issues in current repo */
  async searchIssues(
    projectPath: string,
    searchTerm: string,
    limit: number = 20
  ): Promise<
    Array<{
      number: number;
      title: string;
      url?: string;
      state?: string;
      updatedAt?: string | null;
      assignees?: Array<{ login?: string; name?: string }>;
      labels?: Array<{ name?: string }>;
    }>
  > {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const term = String(searchTerm || '').trim();
    if (!term) return [];
    try {
      const fields = ['number', 'title', 'url', 'state', 'updatedAt', 'assignees', 'labels'];
      const { stdout } = await this.execGH(
        `gh issue list --state open --search ${JSON.stringify(term)} --limit ${safeLimit} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const list = JSON.parse(stdout || '[]');
      if (!Array.isArray(list)) return [];
      return list;
    } catch (error) {
      // Surface empty results rather than failing hard on weird queries
      return [];
    }
  }

  /** Get a single issue with body for enrichment */
  async getIssue(
    projectPath: string,
    number: number
  ): Promise<{
    number: number;
    title?: string;
    body?: string;
    url?: string;
    state?: string;
    updatedAt?: string | null;
    assignees?: Array<{ login?: string; name?: string }>;
    labels?: Array<{ name?: string }>;
  } | null> {
    try {
      const fields = [
        'number',
        'title',
        'body',
        'url',
        'state',
        'updatedAt',
        'assignees',
        'labels',
      ];
      const { stdout } = await this.execGH(
        `gh issue view ${JSON.stringify(String(number))} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const data = JSON.parse(stdout || 'null');
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (error) {
      console.error('Failed to view GitHub issue:', error);
      return null;
    }
  }

  /**
   * Authenticate with GitHub using Personal Access Token
   */
  async authenticateWithToken(token: string): Promise<AuthResult> {
    try {
      // Test the token by getting user info
      const user = await this.getUserInfo(token);

      if (user) {
        // Store token securely
        await this.storeToken(token);
        return { success: true, token, user };
      }

      return { success: false, error: 'Invalid token' };
    } catch (error) {
      console.error('Token authentication failed:', error);
      return {
        success: false,
        error: 'Invalid token or network error',
      };
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      let token = await this.getStoredToken();

      if (!token) {
        const authResult = await this.authenticate();
        if (!authResult.success || !authResult.token) {
          return false;
        }
        token = authResult.token;
      }

      // Test the token by making a simple API call
      const user = await this.getUserInfo(token);
      return !!user;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Get user information using GitHub CLI
   */
  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      // Use gh CLI to get user info
      const { stdout } = await this.execGH('gh api user');
      const userData = JSON.parse(stdout);

      return {
        id: userData.id,
        login: userData.login,
        name: userData.name || userData.login,
        email: userData.email || '',
        avatar_url: userData.avatar_url,
      };
    } catch (error) {
      console.error('Failed to get user info:', error);
      return null;
    }
  }

  /**
   * Get user's repositories using GitHub CLI
   */
  async getRepositories(token: string): Promise<GitHubRepo[]> {
    try {
      // Use gh CLI to get repositories with correct field names
      const { stdout } = await this.execGH(
        'gh repo list --limit 100 --json name,nameWithOwner,description,url,defaultBranchRef,isPrivate,updatedAt,primaryLanguage,stargazerCount,forkCount'
      );
      const repos = JSON.parse(stdout);

      return repos.map((repo: any) => ({
        id: Math.random(), // gh CLI doesn't provide ID, so we generate one
        name: repo.name,
        full_name: repo.nameWithOwner,
        description: repo.description,
        html_url: repo.url,
        clone_url: `https://github.com/${repo.nameWithOwner}.git`,
        ssh_url: `git@github.com:${repo.nameWithOwner}.git`,
        default_branch: repo.defaultBranchRef?.name || 'main',
        private: repo.isPrivate,
        updated_at: repo.updatedAt,
        language: repo.primaryLanguage?.name || null,
        stargazers_count: repo.stargazerCount || 0,
        forks_count: repo.forkCount || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
      throw error;
    }
  }

  /**
   * List open pull requests for the repository located at projectPath.
   */
  async getPullRequests(projectPath: string): Promise<GitHubPullRequest[]> {
    try {
      const fields = [
        'number',
        'title',
        'headRefName',
        'baseRefName',
        'url',
        'isDraft',
        'updatedAt',
        'headRefOid',
        'author',
        'headRepositoryOwner',
        'headRepository',
      ];
      const { stdout } = await this.execGH(`gh pr list --state open --json ${fields.join(',')}`, {
        cwd: projectPath,
      });
      const list = JSON.parse(stdout || '[]');

      if (!Array.isArray(list)) return [];

      return list.map((item: any) => ({
        number: item?.number,
        title: item?.title || `PR #${item?.number ?? 'unknown'}`,
        headRefName: item?.headRefName || '',
        baseRefName: item?.baseRefName || '',
        url: item?.url || '',
        isDraft: item?.isDraft ?? false,
        updatedAt: item?.updatedAt || null,
        headRefOid: item?.headRefOid || undefined,
        author: item?.author || null,
        headRepositoryOwner: item?.headRepositoryOwner || null,
        headRepository: item?.headRepository || null,
      }));
    } catch (error) {
      console.error('Failed to list pull requests:', error);
      throw error;
    }
  }

  /**
   * Ensure a local branch exists for the given pull request by delegating to gh CLI.
   * Returns the branch name that now tracks the PR.
   */
  async ensurePullRequestBranch(
    projectPath: string,
    prNumber: number,
    branchName: string
  ): Promise<string> {
    const safeBranch = branchName || `pr/${prNumber}`;
    let previousRef: string | null = null;

    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
      });
      const current = (stdout || '').trim();
      if (current) previousRef = current;
    } catch {
      previousRef = null;
    }

    try {
      await this.execGH(
        `gh pr checkout ${JSON.stringify(String(prNumber))} --branch ${JSON.stringify(safeBranch)} --force`,
        { cwd: projectPath }
      );
    } catch (error) {
      console.error('Failed to checkout pull request branch via gh:', error);
      throw error;
    } finally {
      if (previousRef && previousRef !== safeBranch) {
        try {
          await execAsync(`git checkout ${JSON.stringify(previousRef)}`, { cwd: projectPath });
        } catch (switchErr) {
          console.warn('Failed to restore previous branch after PR checkout:', switchErr);
        }
      }
    }

    return safeBranch;
  }

  /**
   * Clone a repository to local workspace
   */
  async cloneRepository(
    repoUrl: string,
    localPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure the local path directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Clone the repository
      await execAsync(`git clone "${repoUrl}" "${localPath}"`);

      return { success: true };
    } catch (error) {
      console.error('Failed to clone repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clone failed',
      };
    }
  }

  /**
   * Logout and clear stored token
   */
  async logout(): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }

  /**
   * Store authentication token securely
   */
  private async storeToken(token: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
    } catch (error) {
      console.error('Failed to store token:', error);
      throw error;
    }
  }

  /**
   * Retrieve stored authentication token
   */
  private async getStoredToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  }
}
