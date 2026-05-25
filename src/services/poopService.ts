import NodeCache from "node-cache";
import {
  poopRepository,
  BristolStatsResult,
  PoopListFilters,
} from "../repositories/poop.repository";
import { PoopRecord, CreatePoopRecord, UpdatePoopRecord } from "../types/poop";

// 90s TTL on the dashboard's bristol stats — four parallel COUNT(*)s over
// app.poop / readyToTrainView per uncached call.
const cache = new NodeCache({ stdTTL: 90, checkperiod: 120 });
const BRISTOL_STATS_KEY = "bristolStats";

export class PoopService {
  async getAllPoops(
    page: number = 1,
    limit: number = 10,
    filters: PoopListFilters = {}
  ): Promise<{ records: PoopRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await poopRepository.findAll(offset, limit, filters);

    return {
      records: result.rows,
      total: result.total,
    };
  }

  async getPoopById(id: string): Promise<PoopRecord | null> {
    return poopRepository.findById(id);
  }

  async createPoop(data: CreatePoopRecord): Promise<PoopRecord> {
    return poopRepository.create(data);
  }

  async updatePoop(
    id: string,
    data: Partial<UpdatePoopRecord>
  ): Promise<PoopRecord | null> {
    return poopRepository.update(id, data);
  }

  async searchPoops(
    criteria: Partial<PoopRecord>,
    page: number = 1,
    limit: number = 10
  ): Promise<{ records: PoopRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await poopRepository.search(criteria, offset, limit);

    return {
      records: result.rows,
      total: result.total,
    };
  }

  async getLastTypeVerified(): Promise<{ bristol_type: number } | null> {
    return poopRepository.getLastTypeVerified();
  }

  async getBristolStats(): Promise<BristolStatsResult> {
    const cached = cache.get<BristolStatsResult>(BRISTOL_STATS_KEY);
    if (cached) return cached;
    const fresh = await poopRepository.getBristolStats();
    cache.set(BRISTOL_STATS_KEY, fresh);
    return fresh;
  }

  async updateImage(
    id: string,
    s3Key: string,
    s3Url: string
  ): Promise<PoopRecord | null> {
    return poopRepository.updateImage(id, s3Key, s3Url);
  }
}

export const poopService = new PoopService();
