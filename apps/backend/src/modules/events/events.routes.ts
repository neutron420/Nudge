import { Router } from "express";
import { eventController } from "./events.controller.js";
import { authMiddleware } from "../../api/middleware/auth.middleware.js";
import { validate } from "../../api/middleware/validate.middleware.js";
import {
  createEventSchema,
  updateEventSchema,
  queryEventsSchema,
  queryUpcomingSchema,
} from "./events.schemas.js";

const router = Router();

// Apply authMiddleware to all event routes
router.use(authMiddleware);

router.post("/", validate({ body: createEventSchema }), eventController.create);
router.get("/", validate({ query: queryEventsSchema }), eventController.list);

// Notice: "/upcoming" must be defined before "/:id"
router.get(
  "/upcoming",
  validate({ query: queryUpcomingSchema }),
  eventController.listUpcoming
);

router.get("/:id", eventController.getDetails);
router.patch("/:id", validate({ body: updateEventSchema }), eventController.update);
router.delete("/:id", eventController.delete);
router.patch("/:id/complete", eventController.complete);

export default router;
