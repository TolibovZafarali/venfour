export const homepageExampleAppraisal = {
  vehicle: "2024 Hyundai Elantra SEL",
  insuranceValue: 19_046,
  marketMinimum: 20_800,
  marketMaximum: 21_600,
  reviewedCount: 8,
  vehicles: [
    {
      vehicle: "2024 Hyundai Elantra SEL",
      price: "$20,900",
      mileage: "28,400 mi",
      distance: "11 mi away",
    },
    {
      vehicle: "2024 Hyundai Elantra SEL",
      price: "$21,200",
      mileage: "31,100 mi",
      distance: "18 mi away",
    },
    {
      vehicle: "2024 Hyundai Elantra SEL",
      price: "$21,500",
      mileage: "26,800 mi",
      distance: "24 mi away",
    },
  ],
} as const;

export const homepageExampleDifference = {
  minimum:
    homepageExampleAppraisal.marketMinimum -
    homepageExampleAppraisal.insuranceValue,
  maximum:
    homepageExampleAppraisal.marketMaximum -
    homepageExampleAppraisal.insuranceValue,
} as const;
