import { Request, Response } from "express";
import { firebaseService } from "../services/firebaseService";

export class FirebaseController {
  async getRandomUser(req: Request, res: Response): Promise<void> {
    try {
      const user = await firebaseService.getRandomUser();

      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      console.error("Error in getRandomUser:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch random user from Firebase" },
      });
    }
  }
}

export const firebaseController = new FirebaseController();
