const httpStatus = require("http-status");
const pick = require("../../utils/pick");
const moment = require("moment");
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const ApiError = require("../../utils/ApiError");
const catchAsync = require("../../utils/catchAsync");
const { userService, globalService } = require("../../services/v1");
const {
  User,
  Booking,
  Activity,
  Banner,
  Notification,
  Category,
  BucketList,
  Company,
  Session,
} = require("../../models");
const notify = require("../../config/notifications");
const { createEvent } = require("./auth.controller");
const emailService = require("../../services/v1/email.service");
const activity = require("../../models/activity.model");

const createUser = catchAsync(async (req, res) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(httpStatus.CREATED).send(user);
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const getUsers = catchAsync(async (req, res) => {
  try {
    const filter = pick(req.query, ["name", "role"]);
    const { sortBy = "createdAt", order = "desc" } = req.query;
    const sorting = `${sortBy}:${order}`;
    req.query.sortBy = sorting;
    const options = pick(req.query, ["sortBy", "order", "limit", "page"]);
    filter.role = "user";
    filter.isDeleted = false;
    if (req.query.status) {
      filter.status = req.query.status;
    }
    console.log(req.query.country)
    if (req.query.country) {
      filter.country = req.query.country;
    }
    if (req.query.searchVal) {
      const data = await User.find({ isDeleted: false });
      filter.$or = [
        { firstName: new RegExp(req.query.searchVal, "i") },
        { lastName: new RegExp(req.query.searchVal, "i") },
        { name: new RegExp(req.query.searchVal, "i") },
        { email: new RegExp(req.query.searchVal, "i") },
      ];
    }

    let result = await userService.queryUsers(filter, options);
    console.log(filter)
    let results = await User.find({ role: "user", isDeleted: false });
    const users = results?.map((e) => e._id);
    result.results = await Promise.all(
      result.results.map(async (value) => {
        const count = await Booking.countDocuments({ seekerId: value._id });
        const favoriteActivities = await BucketList.find({ userId: value._id });
        return { ...value._doc, bookingCount: count, favoriteActivities };
      })
    );
    const totalBookings = await Booking.aggregate([
      {
        $match: {
          status: { $in: ["booked"] },
          ownerId: { $in: users },
        },
      },
      {
        $group: {
          _id: "$ownerId",
          totalBookingCount: { $sum: 1 },
        },
      },
    ]);
    const totalEnquiries = await Booking.aggregate([
      {
        $match: {
          userId: { $in: users },
          status: { $ne: "booked" },
        },
      },
      {
        $group: {
          _id: "$userId",
          totalCount: { $sum: 1 },
        },
      },
    ]);
    return res.status(200).json({
      status: 200,
      message: "Users get successfully",
      url: {
        data: result,
        totalBookings: totalBookings,
        totalEnquiries: totalEnquiries,
      },
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const getUsersList = catchAsync(async (req, res) => {
  try {

    let results = await User.find({ role: "user", isDeleted: false, status: "active" }).sort({ createdAt: -1 });
    results = await Promise.all(
      results.map(async (value) => {
        const count = await Booking.countDocuments({ seekerId: value._id });
        const favoriteActivities = await BucketList.countDocuments({ userId: value._id });
        return { ...value._doc, bookingCount: count, favoriteActivities };
      })
    );
    return res.status(200).json({
      status: 200,
      message: "Users get successfully",
      url: {
        data: results,
      },
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const upload = catchAsync(async (req, res) => {
  try {
    if (req.file) {
      const data = `${process.env.BACKEND_URL}/${req.file.filename}`;
      return res.status(200).json({
        status: 200,
        message: "Image upload successfully",
        url: data,
      });
    }
    return res.status(400).json({
      status: 400,
      message: "File doesn't exist",
      data: {},
    });
  } catch (error) {
    return res
      .status(500)
      .send({ status: 500, message: error.message, error: error.stack });
  }
});

const getUser = catchAsync(async (req, res) => {
  try {
    const user = await userService.getUserById(req.params.userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, "User not found");
    }
    res.send(user);
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const updateUser = catchAsync(async (req, res) => {
  try {
    const user = await userService.updateUserById(req.params.userId, req.body);
    res.send(user);
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const deleteUser = catchAsync(async (req, res) => {
  try {
    const { reason, role, id, type, useRole } = req.body;
    let userIds = id
    async function check() {
      if (type === "selected") {
        const findUser = await User.updateMany(
          { _id: { $in: userIds } },
          {
            deletedBy: role,
            reason,
          },
        );
      }
      else {
        const updateResult = await User.updateMany(
          { isDeleted: false, role: useRole },
          {
            deletedBy: role,
            reason,
          },
        );
        if (updateResult.matchedCount === 0) {
          return res.status(404).json({
            status: 404,
            message: 'No users found to update.',
          });
        }
        const updatedUsers = await User.find({ isDeleted: false, role: useRole });
        const updatedUserIds = updatedUsers.map(user => user._id);
        userIds = updatedUserIds;
      }
    }
    await check()
    await userService.deleteUserById(userIds);
    const findUsers = await User.find({ _id: { $in: userIds } })
    const promiseUser = findUsers.map(async (user) => await emailService.sendDeleteUserEmail(user.email, user.firstName, reason))
    await Promise.all(promiseUser)
    res.status(httpStatus.NO_CONTENT).send();
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const getAllUsers = catchAsync(async (req, res) => {
  try {
    const searchKey = req.query.searchVal;
    let query = { role: "user" };
    if (req.query.status) {
      query.status = req.query.status;
    }
    if (searchKey) {
      query.$or = [
        { name: new RegExp(searchKey, "i") },
        { email: new RegExp(searchKey, "i") },
      ];
    }
    const result = await User.find(query).sort("-createdAt");
    return res.status(200).json({
      message: "List of Users",
      data: result,
      count: result.length,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const changeStatus = catchAsync(async (req, res) => {
  try {
    const result = await userService.changeUserStatus(req.params.id);
    if (result) {
      res.status(200).json({ message: "Status changed successfuly" });
    }
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const paymentIntent = catchAsync(async (req, res) => {
  try {
    const amount = req.query.amount ? req.query.amount * 100 : 1;
    const createPayment = await stripe.paymentIntents.create({
      currency: "usd",
      amount: parseInt(amount),
    });
    return res.status(200).json({
      status: 200,
      message: "Client Secret created successfuly",
      clientSecret: createPayment.client_secret,
      pId: createPayment.id,
    });
  } catch (error) {
    return res.status(400).json({
      status: 400,
      message: error.message,
      error: error.stack,
    });
  }
});

const updatePayment = async (req, res) => {
  try {
    const {
      payment_intent,
      redirect_status,
      expertId,
      giftAmount,
      sessionPrice,
      discount,
      fromUserId,
      returnType,
      paymentMethod,
      PayerID,
      paymentId,
    } = req.query;

    let bookingId = req.query.bookingId;
    bookingId = bookingId.trim();
    // if wallet amount used then change it to zero and change the status of booking to booked
    const paymentStatus = await userService.payment(
      bookingId,
      payment_intent,
      giftAmount,
      sessionPrice,
      discount
    );
    const booking = paymentStatus.uniqueId;
    const price = paymentStatus.finalPrice;
    const findPayment = await userService.generatePayment(
      bookingId,
      price,
      paymentMethod
    );

    // calculation for expert wallet
    let expertTotalAmount = [];
    const expertData = await Booking.find({ expertId: expertId });
    for (const expert of expertData) {
      if (expert.expertAmount) {
        expertTotalAmount.push(expert.expertAmount);
      }
    }
    const expertTotalIncome = expertTotalAmount.reduce(function (
      accumalator,
      curValue
    ) {
      return accumalator + curValue;
    },
      0);
    const expertIncome = expertTotalIncome.toFixed(2);
    await Expert.findByIdAndUpdate(
      { _id: expertId },
      { walletAmount: expertIncome }
    ).populate("expertId");
    const payment = findPayment.paymentId;
    const FRONTEND_URL = process.env.FRONTEND_URL;
    if (redirect_status === "succeeded" || redirect_status === "completed") {
      const curBooking = await Booking.findById({ _id: bookingId })
        .populate("userId")
        .populate({ path: "expertId" });

      if (curBooking?.userId) {
        // send notification to user of booking created----->
        const findExpert = await Expert.findById({ _id: expertId });
        await notificationService.sendToUser(findExpert, curBooking);
        // send notification to expert of booking recieved----->
        await notificationService.sendToExpert(curBooking);
      }

      //  create event on google calendar for booking
      if (curBooking?.expertId?.googleCalanderKey) {
        await createEvent(curBooking);
      }

      //****create gift ******/
      if (curBooking?.userId?._id && curBooking.isGifted) {
        const payload = {
          fromUserId: fromUserId,
          giftType: "session",
          bookingId: curBooking._id,
          toUserId: curBooking.userId._id,
        };
        await createGift(payload);
      } else if (curBooking?.toUserEmail) {
        const user = await User.findById({ _id: fromUserId });
        await emailService.inviteFriendSession(
          curBooking?.toUserEmail,
          user.name,
          curBooking
        );
        const payload = {
          fromUserId: fromUserId,
          giftType: "session",
          bookingId: curBooking._id,
          toUserEmail: curBooking.toUserEmail,
        };
        await createGift(payload);
      }

      //***create meeting link----->
      await createZoomMeeting(curBooking);
      if (!returnType) {
        return res.redirect(
          `${FRONTEND_URL}/payment-success?bookingId=${booking}&paymentId=${payment}&price=${price.toFixed(
            2
          )}`
        );
      } else {
        //****create payment with paypal***/
        if (paymentMethod === "paypal" && PayerID) {
          await createPaypalPayment(PayerID, paymentId, price, bookingId);
        }
        return res.status(200).json({
          status: 200,
          message: "Payment Successful",
        });
      }
    } else {
      if (!returnType) {
        return res.redirect(
          `${FRONTEND_URL}/payment-failed?bookingId=${booking}&paymentId=${payment}&price=${price.toFixed(
            2
          )}`
        );
      } else {
        return res.status(400).json({
          status: 400,
          message: "Payment Failed",
        });
      }
    }
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack,
    });
  }
};

const getNotifications = catchAsync(async (req, res) => {
  try {
    const { notifications, totalPages } =
      await notificationService.allNotifications(req.user._id, req.query);
    return res.status(200).json({
      status: 200,
      data: notifications,
      totalPages,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const readNotificaton = catchAsync(async (req, res) => {
  try {
    await notificationService.readNotifications(req.body.ids);
    return res.status(200).json({
      status: 200,
      message: "Notification read successfuly",
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      error: error.message,
      error: error.stack,
    });
  }
});

const deleteNotifications = catchAsync(async (req, res) => {
  try {
    await notificationService.removeNotifications(req.body.ids);
    return res.status(200).json({
      status: 200,
      message: "Notification deleted successfuly",
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack,
    });
  }
});

const getFriends = catchAsync(async (req, res) => {
  try {
    const allFriends = await userService.getFriendsList(req.query, req.user._id);
    return res.status(200).json({
      status: 200,
      message: "Friends List",
      data: allFriends,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const changePassword = catchAsync(async (req, res) => {
  try {
    const { old_pwd, new_pwd } = req.body;
    const user = await User.findById({ _id: req.user._id });
    const match = await user.isPasswordMatch(old_pwd);
    if (!match) {
      return res.status(400).json({
        status: 400,
        message: "Incorrect old password",
      });
    }
    const newMatch = await user.isPasswordMatch(new_pwd);
    if (newMatch) {
      return res.status(400).json({
        status: 400,
        message: "Cannot set old password as new password",
      });
    }
    user.password = new_pwd;
    user.save();
    return res.status(200).json({
      status: 200,
      message: "Password changed successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const deleteAccount = catchAsync(async (req, res) => {
  try {
    const findUser = await User.findByIdAndUpdate(
      { _id: req.user._id },
      { isDeleted: true }
    );
    if (!findUser) {
      return res.status(400).json({
        status: 400,
        message: "User not found",
      });
    }
    if (findUser.role === "expert") {
      const expert = await Expert.findOneAndUpdate(
        { userId: req.user._id },
        { isDeleted: true }
      );
      const bookings = await Booking.find({ expertId: expert._id });
      await Booking.updateMany({ expertId: expert._id }, { isDeleted: true });
      const bookingIds = bookings.map((booking) => booking._id);
      await Payment.updateMany(
        { bookingId: { $in: bookingIds } },
        { $set: { isDeleted: true } }
      );
    } else if (findUser.role === "user") {
      const bookings = await Booking.find({ userId: req.user._id });
      await Booking.updateMany({ userId: req.user._id }, { isDeleted: true });
      const bookingIds = bookings.map((booking) => booking._id);
      await Payment.updateMany(
        { bookingId: { $in: bookingIds } },
        { $set: { isDeleted: true } }
      );
    }
    return res.status(200).json({
      status: 200,
      message: "Account deleted successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});
const inviteFriend = catchAsync(async (req, res) => {
  try {
    const userId = req.user._id;
    const toUser = req.query.toUser;
    const fromUser = await User.findById(userId);
    const result = await userService.inviteFriend(toUser, fromUser.name);
    if (result) {
      return res.status(200).json({
        status: 200,
        message: "Invite sent succesfully",
      });
    }
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});
const getenquirylist = async function (req, res) {
  try {
    const { type } = req.body;
    let getData;
    if (type === "pending") {
      getData = await Booking.find({ status: "pending", ownerId: req.user._id })
        .populate("activity")
        .populate({
          path: "activity",
          populate: { path: "category subCategory" },
        });
      getData.forEach((booking) => {
        const activity = booking.activity;
        if (activity && activity.ratings && activity.ratings.length > 0) {
          const totalRatings = activity.ratings.reduce(
            (sum, rating) => sum + rating,
            0
          );
          const averageRating = totalRatings / activity.ratings.length;
          activity.averageRating = averageRating.toFixed(2); // You can format it to 2 decimal points
        } else {
          activity.averageRating = 0; // Set to 0 if no ratings are available
        }
      });
    } else {
      getData = await Booking.find({ status: "approve", ownerId: req.user._id })
        .populate("activity")
        .populate({
          path: "activity",
          populate: { path: "category subCategory" },
        });
    }
    getData.forEach((booking) => {
      const activity = booking.activity;
      if (activity && activity.ratings && activity.ratings.length > 0) {
        const totalRatings = activity.ratings.reduce(
          (sum, rating) => sum + rating,
          0
        );
        const averageRating = totalRatings / activity.ratings.length;
        activity.averageRating = averageRating.toFixed(2); // You can format it to 2 decimal points
      } else {
        activity.averageRating = 0;
      }
    });

    return res.status(200).json({
      status: 200,
      message: "Enquiry list",
      data: getData,
      Notification,
    });
  } catch (error) {
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack,
    });
  }
};
const enquiryStatus = async function (req, res) {
  try {
    const getData = await Booking.findByIdAndUpdate(
      { _id: req.body.id },
      { status: req.body.status },
      { new: true }
    );
    const user = await User.findOne({ _id: getData.userId });
    if (req.body.status === "approve") {
      let msg = `Dear Seeker, ${user.firstName} your request approved by Activity Owner`;
      notify(
        new RequestStatus(user._id, req.user._id, msg, {
          data: { user },
        })
      );
    } else {
      let msg = `Dear Seeker, ${user.firstName} your request rejected by Activity Owner`;
      notify(
        new RequestStatus(user._id, req.user._id, msg, {
          data: { user },
        })
      );
    }
    return res.status(200).json({
      status: 200,
      message: "Enquiry status updated",
      data: getData,
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};
const getactivitydetails = async function (req, res) {
  try {
    const { type } = req.body;
    const dataDetail = await Category.findOne({ name: type });
    const data = await Activity.find({
      status: "approve",
      category: dataDetail,
    });
    return res.status(200).json({
      status: 200,
      message: "Activity details fetched successfully",
      data: data,
    });
  } catch (error) {
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack,
    });
  }
};
const getNotificationList = async function (req, res) {
  try {
    const data = await Notification.find({ user: req.user._id });
    return res.status(200).json({
      status: 200,
      message: "notification  list here ",
      data: data,
    });
  } catch (error) {
    console.log(error);
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack,
    });
  }
};
const getNotify = async function (req, res) {
  try {
    const users = await User.findOne({ _id: req.user._id });
    let data;
    if (users.role == "owner") {
      data = await Notification.find({
        user: req.user._id,
        type: { $nin: ["user_created", "activity_create"] },
      })
        .populate("user")
        .sort({ createdAt: -1 })
        .limit(3);
    } else {
      data = await Notification.find({
        user: req.user._id,
        type: { $in: ["query_solved", "new_message"] },
      })
        .populate("user")
        .sort({ createdAt: -1 })
        .limit(3);
    }
    return res.status(200).json({
      status: 200,
      message: "notification  list here ",
      data: data,
    });
  } catch (error) {
    console.log(error);
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack,
    });
  }
};
const homelist = async (req, res) => {
  try {
    let suggest = await Activity.find({ status: "approve", isDeleted: false, discounted: true })
      .populate("category userId")
      .sort({ createdAt: -1 });

    suggest = await Promise.all(
      suggest.map(async (activity) => {
        const company = await Company.findOne({ userId: activity.userId });

        if (company) {
          activity = { ...activity._doc, company };
        }

        return activity;
      })
    );

    let companies = await Company.find()
    companies = await Promise.all(
      companies.map(async (company) => {
        const activityCount = await activity.countDocuments({ userId: company.userId, status: "approve" });

        if (activityCount > 0) {
          return company;
        } else {
          return null;
        }
      })
    );
    const filteredCompanies = companies.filter((company) => company !== null);
    
    const category = await Category.find({
      status: "active",
      isDeleted: false,
    });
    return res.status(200).json({
      status: 200,
      message: "Booking list",
      data: {
        suggest: suggest,
        categories: category,
        companies: filteredCompanies
      },
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};

const getCompanyActivities = catchAsync(
  async (req, res) => {
    try {
      const { id } = req.params
      const company = await Company.findById(id)
      if (!company) {
        return res.status(400).json({
          status: 400,
          message: "Company not found",
          id
        });
      }

      let activites = await Activity.find({ userId: company.userId, status: "approve" }).populate("category thrillLevel")

      activites = await Promise.all(
        activites.map(async (activity) => {
          const company = await Company.findOne({ userId: activity.userId });
  
          if (company) {
            activity = { ...activity._doc, company };
          }
  
          return activity;
        })
      );
      const category = await Category.find({
        status: "active",
        isDeleted: false,
      });
      return res.status(200).json({
        status: 200,
        message: "Company's activities fetched successfully",
        data: {
          suggest: activites,
          categories: category,
        },
      });
    } catch (error) {
      console.log(error)
      return res.status(500).json({
        status: 500,
        message: error.message,
        stack: error.stack
      })
    }
  }
)

const bannerList = async (req, res) => {
  try {
    const banners = await Banner.find({ status: "active", isDeleted: false });
    return res.status(200).json({
      status: 200,
      message: "Banner list",
      data: banners,
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};

const topActivities = async (req, res) => {
  try {
    const WATER = await Category.findOne({ name: "Water", isDeleted: false });
    const waterActivities = await Activity.findOne({
      status: "approve",
      category: WATER,
      isDeleted: false,
    })
      .populate("category")
      .sort({ createdAt: -1 });
    const Land = await Category.findOne({ name: "Land", isDeleted: false });
    const landActivities = await Activity.findOne({
      status: "approve",
      category: Land,
      isDeleted: false,
    })
      .populate("category")
      .sort({ createdAt: -1 });
    const Air = await Category.findOne({ name: "Air", isDeleted: false });
    const airActivities = await Activity.findOne({
      status: "approve",
      category: Air,
      isDeleted: false,
    })
      .populate("category")
      .sort({ createdAt: -1 });
    return res.status(200).json({
      status: 200,
      message: "Top Activities",
      data: {
        waterActivities: waterActivities,
        airActivities: airActivities,
        landActivities: landActivities,
      },
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};
const activitiesNearMe = async (req, res) => {
  try {
    const { longitude, latitude } = req.body;
    if (req.body.longitude === "") {
      return res.status(400).json({
        status: 400,
        message: "latitude and longitude is required ",
      });
    }
    const driverNearLocation = await Activity.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          distanceField: "dist.calculated",
          spherical: true,
          maxDistance: 1000,
          includeLocs: "dist.location",
        },
      },
      {
        $match: {
          status: "approve",
          isDeleted: false,
        },
      },
    ]);
    return res.status(200).json({
      status: 200,
      message: "activites near me ",
      data: driverNearLocation,
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};

const bannerCreate = async (req, res) => {
  try {
    await Banner.create(req.body);
    return res.status(200).json({
      status: 200,
      message: "Banner created successfuly",
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
};

const updateBanner = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBanner = await Banner.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!updatedBanner) {
      return res.status(400).json({
        status: 400,
        message: "No banner found with this id",
      });
    }
    return res.status(200).json({
      status: 200,
      message: "Banner updated successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const getBannerById = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);
    return res.status(200).json({
      status: 200,
      data: banner,
      message: "Banner fetched successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const allBanners = catchAsync(async (req, res) => {
  try {
    const result = await userService.findAllBanners(req.query);
    return res.status(200).json({
      status: 200,
      message: "All brands fetched successfuly",
      data: result.data,
      count: result.count,
      page: result.currentPage,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const dashboardBanners = catchAsync(async (req, res) => {
  try {
    const banners = await Banner.find({ isDeleted: false, status: 'active' });
    return res.status(200).json({
      status: 200,
      message: "All brands fetched successfuly",
      data: banners
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});



const deleteBanner = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await globalService.checkAlreadyInUse(Banner, id, "_id");
    if (!banner) {
      return res.status(400).json({
        status: 400,
        message: "No banner found with this id",
      });
    }
    banner.isDeleted = true;
    await banner.save();
    return res.status(200).json({
      status: 200,
      message: "Banner deleted successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

const updateBannerStatus = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await globalService.checkAlreadyInUse(Banner, id, "_id");
    if (!banner) {
      return res.status(400).json({
        status: 400,
        message: "No banner found with this id",
      });
    }
    banner.status = banner.status === "active" ? "inactive" : "active";
    await banner.save();
    return res.status(200).json({
      status: 200,
      message: "Banner status changed successfuly",
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
});

// const specialActivities = catchAsync(async (req, res) => {
//   try {
//     const topActivities = await Booking.aggregate([
//       {
//         $group: {
//           _id: "$activityId",
//           bookingCount: { $sum: 1 },
//         },
//       },
//       {
//         $sort: { bookingCount: -1 },
//       },
//       {
//         $limit: 10,
//       },
//       {
//         $lookup: {
//           from: "activities",
//           localField: "_id",
//           foreignField: "_id",
//           as: "activityDetails",
//         },
//       },
//       {
//         $unwind: "$activityDetails",
//       },
//       {
//         $match: {
//           "activityDetails.isDeleted": false,
//         },
//       },
//       {
//         $lookup: {
//           from: "categories",
//           localField: "activityDetails.category",
//           foreignField: "_id",
//           as: "categoryDetails",
//         },
//       },
//       {
//         $unwind: {
//           path: "$categoryDetails",
//           preserveNullAndEmptyArrays: true,
//         },
//       },
//       {
//         $project: {
//           _id: 0,
//           bookingCount: 1,
//           activity: {

//             $mergeObjects: [
//               "$activityDetails",
//               { category: "$categoryDetails" }
//             ]
//           }
//         }
//       }
//     ]);

//     return res.status(200).json({
//       message: 'Top 10 activities fetched successfully',
//       data: topActivities,
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({
//       message: error.message,
//       status: 500,
//       stack: error.stack,
//     });
//   }
// });
const specialActivities = catchAsync(async (req, res) => {
  try {
    const topActivities = await Booking.aggregate([
      {
        $group: {
          _id: "$activityId",
          bookingCount: { $sum: 1 },
        },
      },
      {
        $sort: { bookingCount: -1 },
      },
      {
        $limit: 10,
      },
      {
        $lookup: {
          from: "activities",
          localField: "_id",
          foreignField: "_id",
          as: "activityDetails",
        },
      },
      {
        $unwind: "$activityDetails",
      },
      {
        $match: {
          "activityDetails.isDeleted": false,
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "activityDetails.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true, // In case no category is found
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "activityDetails.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $unwind: {
          path: "$categoryDetails",
          preserveNullAndEmptyArrays: true, // In case no category is found
        },
      },
      {
        $sort: {
          "activityDetails.createdAt": -1, // Sort by createdAt in descending order
        },
      },
      {
        $project: {
          _id: 0, // Exclude the _id field
          activity: {
            _id: "$activityDetails._id",
            name: "$activityDetails.name",
            photo: "$activityDetails.photo",
            video: "$activityDetails.video",
            address: "$activityDetails.address",
            totalRating: "$activityDetails.totalRating",
            tags: "$activityDetails.tags",
            userId: "$activityDetails.userId",
            branchId: "$activityDetails.branchId",
            category: "$categoryDetails", // Full category object
            status: "$activityDetails.status",
            description: "$activityDetails.description",
            price: "$activityDetails.price",
            subCategory: "$activityDetails.subCategory",
            startHours: "$activityDetails.startHours",
            finishHours: "$activityDetails.finishHours",
            family: "$activityDetails.family",
            spectators: "$activityDetails.spectators",
            special: "$activityDetails.special",
            isDeleted: "$activityDetails.isDeleted",
            createdAt: "$activityDetails.createdAt",
            updatedAt: "$activityDetails.updatedAt",
            __v: "$activityDetails.__v",
            rejectReason: "$activityDetails.rejectReason",
          },
        },
      },
    ]);

    return res.status(200).json({
      message: "Top 10 activities fetched successfully",
      data: topActivities.map((activity) => activity.activity),
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: error.message,
      status: 500,
      stack: error.stack,
    });
  }
});

const manageSession = catchAsync(
  async (req, res) => {
    try {
      const { id, startTime, endTime, role, userId } = req.body;
      let result
      if (id) {
        result = await Session.findByIdAndUpdate(
          id,
          { $set: { endTime } },
          { new: true }
        )
      }
      else {
        result = await Session.create({ userId, startTime, endTime, role })
      }
      return res.status(200).json({
        status: 200,
        message: "Session managed Successfully",
        data: result,
      });
    } catch (error) {
      console.log(error);
      return res.status(500).json({
        message: error.message,
        status: 500,
        stack: error.stack,
      });
    }
  }
)

module.exports = {
  createUser,
  upload,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  getAllUsers,
  changeStatus,
  paymentIntent,
  updatePayment,
  getNotifications,
  readNotificaton,
  deleteNotifications,
  getFriends,
  changePassword,
  deleteAccount,
  inviteFriend,
  getenquirylist,
  enquiryStatus,
  getactivitydetails,
  getNotificationList,
  homelist,
  getNotify,
  bannerList,
  bannerCreate,
  activitiesNearMe,
  topActivities,
  updateBanner,
  getBannerById,
  allBanners,
  deleteBanner,
  updateBannerStatus,
  specialActivities,
  dashboardBanners,
  manageSession,
  getUsersList,
  getCompanyActivities
};
