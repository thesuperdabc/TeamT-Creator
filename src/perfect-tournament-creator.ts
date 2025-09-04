import fetch from "node-fetch";
import { URLSearchParams } from "url";
import * as fs from "fs";

interface TournamentSettings {
  hostTeamId: string;
  description: string;
  lastTournamentDayNum: number;
  leadersPerTeam: number;
  dayStartHour: number;
  nightStartHour: number;
  tournamentDurationMinutes: number;
  clockTimeMinutes: number;
  clockIncrementSeconds: number;
  rated: boolean;
  variant: string;
}

interface TournamentState {
  lastCreationDate: string;
}

function readJSON<T>(path: string): T {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw) as T;
}

function writeJSON<T>(path: string, data: T): void {
  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function createTournamentDate(year: number, month: number, day: number, hour: number, minute: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  return date.toISOString();
}

function buildTournamentName(dayNum: number, type: 'Day' | 'Night'): string {
  return `LMAO ${type} '${dayNum}'`;
}

function buildDescription(dayNum: number, type: 'Day' | 'Night', template: string): string {
  return template
    .replace('{TYPE}', type)
    .replace('{DAY_NUM}', String(dayNum));
}

function validateOAuthToken(token: string): boolean {
  if (!token || token.trim() === "") {
    return false;
  }
  
  if (token.includes("***") || token.includes("YOUR_TOKEN") || token.includes("PLACEHOLDER")) {
    return false;
  }
  
  const tokenRegex = /^[a-zA-Z0-9_-]+$/;
  return tokenRegex.test(token) && token.length > 10;
}

async function createTeamBattle(params: {
  server: string;
  token: string;
  name: string;
  description: string;
  clockTime: number;
  clockIncrement: number;
  minutes: number;
  rated: boolean;
  variant: string;
  startDateISO: string;
  hostTeamId: string;
  teams: string[];
  dryRun?: boolean;
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  
  if (!validateOAuthToken(params.token)) {
    return { ok: false, error: "Invalid or missing OAuth token. Please set a valid OAUTH_TOKEN environment variable." };
  }

  const body = new URLSearchParams({
    name: params.name,
    description: params.description,
    clockTime: String(params.clockTime),
    clockIncrement: String(params.clockIncrement),
    minutes: String(params.minutes),
    rated: params.rated ? 'true' : 'false',
    variant: params.variant,
    startDate: params.startDateISO
  });
  
  // Add team battle parameters
  body.append('teamBattleByTeam', params.hostTeamId);
  
  // Add teams
  const invitedTeams = params.teams.filter((t) => t && t !== params.hostTeamId);
  invitedTeams.forEach((t) => body.append('teams[]', t));

  if (params.dryRun) {
    console.log(`[DRY RUN] Would create: ${params.name}`);
    console.log(`[DRY RUN] Start: ${params.startDateISO}`);
    console.log(`[DRY RUN] Teams: ${invitedTeams.join(', ')}`);
    console.log(`[DRY RUN] Leaders per team: 20`);
    return { ok: true, url: `${params.server}/team/${params.hostTeamId}/arena/pending` };
  }

  try {
    const apiUrl = `${params.server}/api/tournament`;
    console.log(`Making request to: ${apiUrl}`);
    console.log(`Team ID: ${params.hostTeamId}`);
    
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'LMAO-Teamfights-Creator/1.0'
      },
      body,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Tournament creation failed:", res.status, errorText);
      return { ok: false, error: `${res.status}: ${errorText}` };
    }

    const data: any = await res.json();
    const url = data?.id ? `${params.server}/tournament/${data.id}` : res.headers.get('Location') || 'unknown';
    console.log("Created tournament:", url);
    return { ok: true, url };

  } catch (error) {
    console.error("Network error:", error);
    return { ok: false, error: String(error) };
  }
}

async function main() {
  try {
    const oauthToken = process.env.OAUTH_TOKEN;
    if (!oauthToken) {
      throw new Error("OAUTH_TOKEN environment variable is required");
    }

    // Load settings from config file
    const settings = readJSON<TournamentSettings>("config/tournament-settings.json");
    const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

    // Load or initialize state
    const stateFilePath = "config/perfect-tournament.state.json";
    let state: TournamentState;
    try {
      state = readJSON<TournamentState>(stateFilePath);
    } catch (error) {
      console.warn(`Could not read ${stateFilePath}, initializing with default state.`);
      state = {
        lastCreationDate: ""
      };
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Check if we already created tournaments today
    if (state.lastCreationDate === today) {
      console.log("Tournaments already created today. Skipping.");
      return;
    }

    // Calculate next tournament numbers
    let nextDayNum = settings.lastTournamentDayNum + 1;
    
    // Create tournaments for the next 7 days
    const tournaments = [];
    
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const tournamentDayNum = nextDayNum + dayOffset;
      const targetDate = new Date(now);
      targetDate.setUTCDate(targetDate.getUTCDate() + dayOffset);
      
      const year = targetDate.getUTCFullYear();
      const month = targetDate.getUTCMonth() + 1;
      const day = targetDate.getUTCDate();

      // Day tournament
      tournaments.push({
        name: buildTournamentName(tournamentDayNum, 'Day'),
        description: buildDescription(tournamentDayNum, 'Day', settings.description),
        startDateISO: createTournamentDate(year, month, day, settings.dayStartHour, 0),
        dayNum: tournamentDayNum,
        type: 'Day' as const
      });

      // Night tournament
      tournaments.push({
        name: buildTournamentName(tournamentDayNum, 'Night'),
        description: buildDescription(tournamentDayNum, 'Night', settings.description),
        startDateISO: createTournamentDate(year, month, day, settings.nightStartHour, 0),
        dayNum: tournamentDayNum,
        type: 'Night' as const
      });
    }

    console.log(`Creating ${tournaments.length} tournaments (Days ${nextDayNum}-${nextDayNum + 6})`);
    console.log(`Team: ${settings.hostTeamId}`);
    console.log(`Leaders per team: ${settings.leadersPerTeam}`);

    let successCount = 0;
    let failureCount = 0;

    // Create all tournaments with delays
    for (let i = 0; i < tournaments.length; i++) {
      const tournament = tournaments[i];
      
      console.log(`\n--- Creating ${tournament.type} Battle ${tournament.dayNum} ---`);
      console.log("Name:", tournament.name);
      console.log("Start:", tournament.startDateISO);

      if (i > 0) {
        console.log("Waiting 10 seconds to avoid rate limits...");
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      const result = await createTeamBattle({
        server: "https://lichess.org",
        token: oauthToken,
        name: tournament.name,
        description: tournament.description,
        clockTime: settings.clockTimeMinutes,
        clockIncrement: settings.clockIncrementSeconds,
        minutes: settings.tournamentDurationMinutes,
        rated: settings.rated,
        variant: settings.variant,
        startDateISO: tournament.startDateISO,
        hostTeamId: settings.hostTeamId,
        teams: [settings.hostTeamId],
        dryRun: dryRun,
      });

      if (result.ok) {
        successCount++;
        console.log(`${tournament.type} battle created successfully`);
      } else {
        failureCount++;
        console.error(`Failed to create ${tournament.type} battle: ${result.error}`);
      }
    }

    // Update state
    if (successCount > 0) {
      const maxDayNum = Math.max(...tournaments.map(t => t.dayNum));
      settings.lastTournamentDayNum = maxDayNum;
      state.lastCreationDate = today;
      writeJSON("config/tournament-settings.json", settings);
      writeJSON(stateFilePath, state);
      console.log(`\nUpdated settings: lastTournamentDayNum = ${settings.lastTournamentDayNum}`);
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log(`Next tournaments will start from Day: ${settings.lastTournamentDayNum + 1}`);

    if (failureCount > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}