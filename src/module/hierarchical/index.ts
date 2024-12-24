import { ElizaConnector } from '../connector';
import { Member, GroupConfig } from '../../types';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { createLogger, saveReport } from '../../utils/logger';
import { sleep } from "../../utils/time";

const logger = createLogger('hierarchical');

// Load environment variables from .env file
dotenv.config();

const reportDir = path.resolve(__dirname, '../../reports');

if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

// Interface for Follower Responses
interface FollowerResponses {
  [followerId: string]: string;
}

// LeaderAgent class responsible for managing followers
class LeaderAgent {
  private elizaConnector: ElizaConnector;
  private goal: string;
  private leader: Member;
  private followers: Member[];

  constructor(connector: ElizaConnector, goal: string, leader: Member, followers: Member[]) {
    this.elizaConnector = connector;
    this.goal = goal;
    this.leader = leader;
    this.followers = followers;
  }

  /**
   * Generates the meeting start message based on members' roles.
   * @param membersRoles - Array of member objects with their roles.
   * @param goal - The goal of the meeting.
   * @returns The meeting start message.
   */
  async generateMeetingStartMessage(membersRoles: Member[], goal: string): Promise<string | undefined> {
    const rolesDescription = membersRoles.map(member => `${member.name} (${member.role})`).join(', ');
    const response = await this.elizaConnector.sendMessage(this.leader.id, `The meeting is starting. Participants: ${rolesDescription}. Goal: ${goal}. You are leader, Please generate intro message.`);
    return response?.text;
  }

  /**
   * Generates the meeting start message based on members' roles.
   * @param membersRoles - Array of member objects with their roles.
   * @returns The meeting start message.
   */
  async generateMeetingEndMessage(membersRoles: Member[]): Promise<string | undefined> {
    const rolesDescription = membersRoles.map(member => `${member.name} (${member.role})`).join(', ');
    const response = await this.elizaConnector.sendMessage(this.leader.id, `The meeting is concluded. Participants: ${rolesDescription}. You are leader, Please generate outro message.`);
    return response?.text;
  }

  /**
   * Broadcasts a message to all follower agents and collects their responses.
   * @param messageContent - The message content to broadcast.
   * @returns An object mapping follower IDs to their responses.
   */
  async broadcastMessage(messageContent: string): Promise<FollowerResponses> {
    const responses: FollowerResponses = {};

    const sendPromises = this.followers.map(async (follower) => {
      let response;
      switch (follower.type) {
        case "eliza":
          response = await this.elizaConnector.sendMessage(follower.id, messageContent);
          break;
        default:
          logger.warn(`Unsupported agent type: ${follower.type}`);
          break;
      }
      if (response) {
        responses[follower.id] = response.text;
      } else {
        responses[follower.id] = "No response.";
      }
    });

    await Promise.all(sendPromises);
    return responses;
  }

  /**
   * Generates feedback based on followers' responses.
   * @param responses - The responses from follower agents.
   * @returns The feedback message content.
   */
  async generateFeedback(responses: string): Promise<string | undefined> {
    const response = await this.elizaConnector.sendMessage(this.leader.id, responses);
    return response?.text;
  }
}

// FollowerAgent class representing each follower
class FollowerAgent {
  private agent: Member;
  private connector: ElizaConnector;

  constructor(agent: Member, connector: ElizaConnector) {
    this.agent = agent;
    this.connector = connector;
  }
}

// HierarchicalSystem class managing the overall communication cycles
export class HierarchicalSystem {
  private readonly connector: ElizaConnector;
  private readonly leaderAgent: LeaderAgent;
  private followerAgents: FollowerAgent[];
  private readonly maxCycles: number;
  private currentCycle: number;
  private reportContent: string;

  constructor(config: GroupConfig, baseUrl: string, maxCycles: number = 10) {
    if (config.type !== "hierarchical") {
      throw new Error("HierarchicalSystem can only be initialized with type 'hierarchical'.");
    }
    if (!config.leader) {
      throw new Error("Leader is required for hierarchical type.");
    }

    this.connector = new ElizaConnector(baseUrl);
    this.leaderAgent = new LeaderAgent(this.connector, config.goal, config.leader, config.members);
    this.followerAgents = config.members.map(member => new FollowerAgent(member, this.connector));

    this.maxCycles = maxCycles;
    this.currentCycle = 0;
    this.reportContent = `# Lushan System Report (Hierarchical Mode)\n\nGenerated on ${new Date().toLocaleString()}\n\n`;
  }

  /**
   * Runs the hierarchical communication cycles.
   */
  async run(): Promise<void> {
    logger.info("Hierarchical System started.");
    console.log("Hierarchical System started.");

    // Initial step: Leader generates the meeting start message based on members' roles
    let leaderMessage = await this.leaderAgent.generateMeetingStartMessage(this.leaderAgent['followers'], this.leaderAgent["goal"]);
    logger.info(`[${this.leaderAgent["leader"].name}(Leader)] Generated meeting start message: "${leaderMessage}"`);
    console.log(`[${this.leaderAgent["leader"].name}(Leader)] Generated meeting start message: "${leaderMessage}"`);

    while (true) {
      this.currentCycle += 1;
      logger.info(`=== Communication Cycle ${this.currentCycle} ===`);
      console.log(`\n=== Communication Cycle ${this.currentCycle} ===`);

      // Step 1: Leader broadcasts the message to all followers
      logger.info(`[${this.leaderAgent["leader"].name}(Leader)] Broadcasting message: "${leaderMessage}"`);
      console.log(`[${this.leaderAgent["leader"].name}(Leader)] Broadcasting message: "${leaderMessage}"`);
      const followerResponses = await this.leaderAgent.broadcastMessage(leaderMessage ?? "");

      let followerResponseText = "";
      // Step 2: Log followers' responses
      for (const [followerId, responseText] of Object.entries(followerResponses)) {
        const follower = this.followerAgents.find(agent => agent['agent'].id === followerId);
        if (follower) {
          logger.info(`[${follower['agent'].name}(${follower['agent'].role})]: "${responseText}"`);
          console.log(`[${follower['agent'].name}(${follower['agent'].role})]: "${responseText}"`);
          this.reportContent += `## Cycle ${this.currentCycle} - ${follower['agent'].name} (${follower['agent'].role})\n\n- Response: "${responseText}"\n\n`;
          followerResponseText += `${follower['agent'].name} (${follower['agent'].role}): "${responseText}"\n`;
        }
      }

      if (this.maxCycles <= this.currentCycle) break;

      // Step 3: Leader generates and sends feedback to followers
      leaderMessage = await this.leaderAgent.generateFeedback(followerResponseText);

      logger.info(`Waiting for the next cycle...`);
      console.log(`Waiting for the next cycle...`);
      await sleep(30);
    }

    // Initial step: Leader generates the meeting start message based on members' roles
    leaderMessage = await this.leaderAgent.generateMeetingEndMessage(this.leaderAgent['followers']);
    logger.info(`[${this.leaderAgent["leader"].name}(Leader)] Generated meeting end message: "${leaderMessage}"`);
    console.log(`[${this.leaderAgent["leader"].name}(Leader)] Generated meeting end message: "${leaderMessage}"`);

    // Final step: Notify all members that the meeting has ended
    logger.info(`[System] Sending meeting end message: "${leaderMessage}"`);
    console.log(`[System] Sending meeting end message: "${leaderMessage}"`);
    let followerResponses = await this.leaderAgent.broadcastMessage(leaderMessage ?? "");

    for (const [followerId, responseText] of Object.entries(followerResponses)) {
      const follower = this.followerAgents.find(agent => agent['agent'].id === followerId);
      if (follower) {
        logger.info(`[${follower['agent'].name}(${follower['agent'].role})]: "${responseText}"`);
        console.log(`[${follower['agent'].name}(${follower['agent'].role})]: "${responseText}"`);
        this.reportContent += `## Meeting Ended\n\n ${this.currentCycle} - ${follower['agent'].name} (${follower['agent'].role})\n\n- Response: "${responseText}"\n\n`;
      }
    }

    // Save the report
    saveReport('hierarchical', this.reportContent);

    logger.info("Hierarchical System has completed all communication cycles.");
    console.log("\n=== The meeting has concluded. ===");
  }
}
