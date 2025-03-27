const { Subscription, User, Transaction } = require('../../models');
const Payment = require('../../models/payment.model');
const mongoose = require("mongoose")
const globalService = require('../../services/v1/global.service')
const endPoint = 'whsec_7MW1dOeunIzaq64mAkURa6p7kvCe9DzY'
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.createSubscription = async function (req, res) {
  try {
    const date = new Date();
    const oneMonthLater = date.setMonth(date.getMonth() + 1);
    const start = new Date(req.body.startDate);
    // console.log(months);return
    let payload = {
      available: oneMonthLater,
      plan: req.body.plan,
      name: req.body.name,
      // branches: req.body.branches,
      description: req.body.description,
      price: req.body.price,
      type: req.body.type,
      // noOfActivities: req.body.noOfActivities,
      noOfPhotos: req.body.noOfPhotos,
      noOfVideos: req.body.noOfVideos,
      planType: req.body.planType
    }

    const data = await Subscription.create(payload);
    return res.status(200).json({
      status: 200,
      message: 'Subscription added ',
      data: data,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack
    })
  }
}
exports.updateSubscription = async function (req, res) {
  try {
    // console.log(req.body,"body part ");return
    await Subscription.findByIdAndUpdate({ _id: req.params.id }, req.body, { new: true });
    const finddetail = await Subscription.findById({ _id: req.params.id });
    return res.status(200).json({
      status: 200,
      message: 'Subscription plan update successfully ',
      data: finddetail,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack
    })
  }
}

exports.statusSubscription = async function (req, res) {
  try{
  const findUser = await Subscription.findById({ _id: req.params.id });
  const newStatus = findUser.status === 'active' ? 'inactive' : 'active';
  await Subscription.findByIdAndUpdate({ _id: req.params.id }, {
    status: newStatus
  }, { new: true });

  return res.status(200).json({
    status: 200,
    message: "status changed",
    data: findUser
  })}
  catch(error){
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
}

exports.deleteSubscription = async function (req, res) {
  try {
    const result = await globalService.checkAlreadyInUse(User, req.params.id, 'subscriptionId');
    if (result) {
      return res.status(400).json({
        status: 400,
        message: 'Unable to delete subscription because it is already in use'
      })
    }
    console.log(result, 'result');
    const findetail = await Subscription.findByIdAndDelete({ _id: req.params.id });
    return res.status(200).json({
      status: 200,
      message: 'Subscription deleted successfully ',
      data: findetail,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack
    })
  }
}
exports.getSubscriptions = async function (req, res) {
  try {
    const data = await Subscription.find({ isDeleted: false });
    return res.status(200).json({
      status: 200,
      message: 'Subscription get successfully ',
      data: data,
    });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      error: error.stack
    })
  }
}
exports.buySubscriptionsPlan = async (req, res) => {
  const { id } = req.params
  try {
    const subscriptions = await Subscription.findByIdAndUpdate(id, { $push: { parentId: req.user.id } }, { new: true });
    if (!subscriptions) {
      return res.status(404).json({ message: "No plans found." })
    }
    const vendor = await User.findByIdAndUpdate({ _id: req.user.id }, { subscriptionId: id }, { new: true }).populate("subscriptionId");
    return res.status(200).json({ message: "Plan activated successfully", data: vendor })
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong", error: error })
  }
}
exports.getSubscriptionsPlan = async (req, res) => {
  try {
    let query={
      isDeleted:false
    }
    if(req.query.searchVal){
      query={
        $or:[
          {name:{$regex:req.query.searchVal,$options:'i'}},
          {plan:{$regex:req.query.searchVal,$options:'i'}}
        ]
    }
  }
    const subscriptions = await Subscription.find(query).sort({createdAt:-1})
    if (!subscriptions) {
      return res.status(404).json({ message: "No plans found." })
    }
    return res.status(200).json({ message: "Plan found", data: subscriptions })
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong", error: error })
  }
}
exports.getSubscription = async (req, res) => {
  try {
    const subscriptions = await Subscription.findOne({ _id: req.body.id })
    if (!subscriptions) {
      return res.status(404).json({ message: "No plans found." })
    }
    return res.status(200).json({ message: "Plan found", data: subscriptions })
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong", error: error })
  }
}
exports.getplans = async (req, res) => {
  try {
    const { id: subscriptionId } = req.params;
    const subscriptions = await Subscription.findOne({ _id: subscriptionId });
    const paymentData = await Payment.aggregate([
      {
        $match: {
          subscriptionId: new mongoose.Types.ObjectId(subscriptionId),
          status: 'completed', 
        },
      },
      {
        $group: {
          _id: null, 
          uniqueOwnerIds: { $addToSet: '$ownerId' }, 
          totalAmount: { $sum: '$finalAmount' }, 
        },
      },
      {
        $project: {
          _id: 0,
          totalPayments: { $size: '$uniqueOwnerIds' }, 
          totalAmount: 1,
        },
      },
    ]);
    const { totalPayments = 0, totalAmount = 0 } = paymentData.length > 0 ? paymentData[0] : {};
    if (!subscriptions) {
      return res.status(404).json({ message: "No plans found." });
    }
    return res.status(200).json({
      message: "Plan found",
      data: {
        ...subscriptions.toObject(),
        totalPayments, 
        totalAmount,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message, error: error });
  }
};

exports.paymentCreate = async (req, res) => {
  try {
    const userDetail = await User.findOne({ _id: req.user._id });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: req.body.amount,
      currency: 'usd',
      customer: userDetail.liveCustomerId ?? userDetail.devCustomerId,
      payment_method_types: ['card']
    });
    const id = req.body.paymentMethodId;
    await Transaction.create({
      // userId: req.params.id,
      userId: req.user._id,
      paymentIntentId: paymentIntent.id,
      amount: req.body.amount,
      paymentMethod: req.body.paymentMethodId,
      status: paymentIntent.status,
      subscriptionId: req.body.subscriptionId,
      transactionTo: req.body.userId,
      coupons: req.body.discountCode
    })
    return res.status(200).json({ status: 200, message: "payment create", data: paymentIntent, pamyentMethod: id, clientSecret: paymentIntent.client_secret });
  }
  catch (error) {
    console.log(error)
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack
    })
  }
}
exports.checkPayment = async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(req.body.id);
    if (paymentIntent.status === 'succeeded') {
      await Transaction.findOneAndUpdate({
        paymentIntentId: paymentIntent.id,
      }, {
        status: paymentIntent.status,
      },
        { new: true })
    }
    return res.status(200).json({ status: 200, message: "payment check", data: paymentIntent, });
  }
  catch (error) {
    console.log(error)
    return res.status(403).json({
      status: 403,
      message: error.message,
      stack: error.stack
    })
  }
}
exports.attachPayment = async (req, res) => {
  try {
    const userdetail = await User.findOne({ _id: req.user._id })
    const paymentMethodAttach = await stripe.paymentMethods.attach(
      req.body.id,
      {
        customer: userdetail.liveCustomerId ?? userdetail.devCustomerId
      });
    return res.status(200).json({ status: 200, message: "payment attached", paymentMethodAttach: paymentMethodAttach });
  }
  catch (error) {
    console.log(error)
    return res.status(500).json({
      status: 500,
      message: error.message,
      stack: error.stack
    })
  }
}
exports.createToken = async (cardData) => {
  let token = {};
  try {
    token = await stripe.tokens.create({
      card: {
        number: cardData.cardNumber,
        exp_month: cardData.month,
        exp_year: cardData.year,
        cvc: cardData.cvv
      }
    });
    return res.status(200).json({
      status: 200,
      message: "Token created successfully",
      data: token
    })
  } catch (error) {
    switch (error.type) {
      case 'StripeCardError':
        token.error = error.message;
        break;
      default:
        token.error = error.message;
        break;
    }
  }
}

