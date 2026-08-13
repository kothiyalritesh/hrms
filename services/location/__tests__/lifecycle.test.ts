import {
  isAuthoritativeCheckoutTransition,
  isOpenAttendance,
} from "@/services/location/attendanceLifecycle";

describe("attendance-linked tracking lifecycle", () => {
  const open = {
    id: "attendance-1",
    date: "2026-07-22",
    checkin_time: "2026-07-22T18:00:00.000Z",
    checkout_time: null,
    checkout_source: null,
    status: "CHECKED_IN",
  };

  test("attendance remains open across midnight", () => {
    expect(isOpenAttendance(open)).toBe(true);
  });

  test("confirmed app checkout stops tracking", () => {
    expect(
      isAuthoritativeCheckoutTransition(open, {
        ...open,
        checkout_time: "2026-07-23T04:00:00.000Z",
        checkout_source: "APP",
        status: "CHECKED_OUT",
      }),
    ).toBe(true);
  });

  test.each(["BIOMETRIC", "SMARTOFFICE", "PUNCH_MACHINE", "SYSTEM"])(
    "%s punch is not an authoritative tracking stop",
    (checkoutSource) => {
      expect(
        isAuthoritativeCheckoutTransition(open, {
          ...open,
          checkout_time: "2026-07-23T04:00:00.000Z",
          checkout_source: checkoutSource,
        }),
      ).toBe(false);
    },
  );
});
